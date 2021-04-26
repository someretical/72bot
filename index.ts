import util from 'util';
import { stripIndents } from 'common-tags';
import {
	Client,
	Collection,
	ColorResolvable,
	Message,
	MessageEmbed,
	Snowflake,
	Util,
	Webhook,
	WebhookClient,
	WebhookEditData,
} from 'discord.js';
import mineflayer, { Bot } from 'mineflayer';
import { ping } from 'minecraft-protocol';
import {
	whitelistedUsers,
	whitelistedUsernames,
	whitelistedChannels,
	mcServerAddress,
	mcServerImage,
	discordPrefix,
	mcPrefix,
} from './constants';

const discordClient = new Client();
const webhooks: Collection<Snowflake, WebhookClient> = new Collection();
let mcClient: Bot;
let ownerID: Snowflake;
let reconnectTimeout: ReturnType<typeof setTimeout>;
let connected = false;
let locked = false;
let disconnectLocked = false;
let lastResult: unknown = null;

const makeResultMessages = (
	result: unknown,
	hrDiff: number[],
	input: string
) => {
	const inspected = util.inspect(result, { depth: 0 }).replace(/!!NL!!/g, '\n');
	const split = inspected.split('\n');
	const last = inspected.length - 1;
	const prependPart =
		inspected[0] !== '{' && inspected[0] !== '[' && inspected[0] !== "'"
			? split[0]
			: inspected[0];
	const appendPart =
		inspected[last] !== '}' &&
		inspected[last] !== ']' &&
		inspected[last] !== "'"
			? split[split.length - 1]
			: inspected[last];
	const prepend = `\`\`\`js\n${prependPart}\n`;
	const append = `\n${appendPart}\n\`\`\``;

	if (input) {
		return Util.splitMessage(
			stripIndents`
				*Executed in ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.*
				\`\`\`js
				${inspected}
				\`\`\`
			`,
			{ maxLength: 1900, prepend, append }
		);
	}
	return Util.splitMessage(
		stripIndents`
			*Callback executed after ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${
			hrDiff[1] / 1000000
		}ms.*
			\`\`\`js
			${inspected}
			\`\`\`
			`,
		{ maxLength: 1900, prepend, append }
	);
};

// For old merged function, see https://www.typescriptlang.org/docs/handbook/release-notes/typescript-1-6.html#user-defined-type-guard-functions
// const mapWebhooks = (
// 	obj: WebhookEditData | WebhookMessageOptions,
// 	func: 'send' | 'edit' = 'send'
// ) => {
// 	const promises: Array<Promise<Webhook | Message>> = [];
// 	webhooks.map(hook => promises.push(hook[func](obj)));
// 	return Promise.all(promises);
// };

const editWebhooks = (obj: WebhookEditData) => {
	const promises: Array<Promise<Webhook>> = [];
	webhooks.map(hook => promises.push(hook.edit(obj)));
	return Promise.all(promises);
};

const codeBlock = (str: string, lang = '') =>
	`\`\`\`${lang}\n${str.replace(/```/g, '\\`\\`\\`')}\n\`\`\``;

const getPlayerHead = (username: string) =>
	`https://mc-heads.net/avatar/${username}`;

const sendWebhookMessage = (
	text: string,
	colour: ColorResolvable = 'BLURPLE',
	username: string = mcServerAddress,
	avatarURL: string = mcServerImage
) => {
	const promises: Array<Promise<Message>> = [];
	webhooks.map(hook =>
		promises.push(
			hook.send(
				new MessageEmbed()
					.setAuthor(username, avatarURL)
					.setDescription(codeBlock(text))
					.setColor(colour)
			)
		)
	);

	return Promise.all(promises);
};

const createWebhooks = () => {
	const data = (process.env.WEBHOOKS || '')
		.split(',')
		.map(str => str.split(':'));

	for (const obj of data)
		webhooks.set(obj[0], new WebhookClient(obj[0], obj[1]));

	return editWebhooks({ name: mcServerAddress, avatar: mcServerImage });
};

const checkServerStatus = util.promisify(ping);

const checkHealth = async () => {
	const health = mcClient.health;
	const food = mcClient.food;
	const player = mcClient.player;
	const entities = mcClient.entities;

	if (
		!connected ||
		health === undefined ||
		food === undefined ||
		!player ||
		!entities
	)
		return;

	if (health > 19 && food > 8) return;

	locked = true;
	mcClient.quit();

	const otherPlayers = Object.values(entities)
		.filter(e => e.type === 'player' && e.username !== player.username)
		.map(e => e.username);

	console.log(
		`Autolog triggered at ${health} HP and ${food} hunger points.\n\nPlayers in render distance: ${otherPlayers
			.map(u => `\`${u}\``)
			.join(', ')}`
	);

	await sendWebhookMessage(
		`Autolog triggered at ${health} HP and ${food} hunger points.\n\nPlayers in render distance: ${otherPlayers
			.map(u => `\`${u}\``)
			.join(', ')}`,
		'RED',
		player.username,
		getPlayerHead(player.username)
	);
};

const connectToMinecraft = async () => {
	if (locked) {
		console.log('Not reconnecting due to lock');

		return sendWebhookMessage(
			'The bot has been locked. Use the reconnect command to reconnect to the server.'
		);
	}

	if (!disconnectLocked) {
		console.log(`Connecting to ${mcServerAddress}`);

		await sendWebhookMessage(`Connecting to ${mcServerAddress}...`);
	}

	try {
		await checkServerStatus({ host: mcServerAddress });
	} catch (err) {
		if (!disconnectLocked) {
			console.log(`${mcServerAddress} is down`);
			console.log('Setting reconnect timeout of 10000ms');

			await sendWebhookMessage(
				`${mcServerAddress} is down, the bot will reconnect in the background.`,
				'RED'
			);
		}

		disconnectLocked = true;

		clearTimeout(reconnectTimeout);
		reconnectTimeout = setTimeout(connectToMinecraft, 10000);

		return undefined;
	}

	mcClient = mineflayer.createBot({
		host: mcServerAddress,
		username: String(process.env.MC_EMAIL),
		password: String(process.env.MC_PWD),
		hideErrors: false,
	});

	mcClient.on('spawn', async () => {
		connected = true;
		disconnectLocked = false;

		console.log('Spawned into minecraft world');

		await sendWebhookMessage(
			`Logged into ${mcServerAddress} as ${mcClient.player.username}`,
			'BLURPLE',
			mcClient.player.username,
			getPlayerHead(mcClient.player.username)
		);

		checkHealth();
	});

	mcClient.on('health', checkHealth);

	mcClient.on('message', data => {
		const message = data.toString().trim();
		if (!message) return undefined;

		const joinLeave =
			message.match(/^\w{3,16} (?:joined|left) the game$/) || [];
		if (joinLeave.length) return sendWebhookMessage(message, 'GREY');

		const parsedMessage = message.match(/^<(\w{3,16})> (.+)$/) || [];
		if (parsedMessage[2]) {
			// if (whitelistedUsernames.includes(parsedMessage[1])) {
			// 	// command stuff
			// }

			return sendWebhookMessage(
				parsedMessage[2],
				/^>/.test(parsedMessage[2]) ? 'GREEN' : [254, 254, 254],
				parsedMessage[1],
				getPlayerHead(parsedMessage[1])
			);
		}

		const server = message.match(/^\[server\] (.+)$/i) || [];
		if (server[1]) return sendWebhookMessage(server[1], 'ORANGE');

		const colour: [
			number,
			number,
			number
		] = /^(?:\w{3,16} whispers: (.+)|To \w{3,16}: (.+))$/.test(message)
			? [255, 0, 255]
			: [0, 170, 170];

		return sendWebhookMessage(message, colour);
	});

	mcClient.on('end', () => {
		connected = false;

		if (!disconnectLocked) {
			console.log(`Disconnected from ${mcServerAddress}`);
			console.log('Setting reconnect timeout of 10000ms');

			sendWebhookMessage(`Disconnected from ${mcServerAddress}.`, 'BLURPLE');
		}

		if (reconnectTimeout) clearTimeout(reconnectTimeout);
		reconnectTimeout = setTimeout(connectToMinecraft, 10000);
	});

	return undefined;
};

discordClient.on('ready', async () => {
	console.log('Logged into Discord bot');

	const { owner } = await discordClient.fetchApplication();
	ownerID = owner?.id || '';
});

discordClient.on('message', async message => {
	const { author, content, channel } = message;
	if (!whitelistedChannels.includes(channel.id) || author.bot) return undefined;

	if (content.startsWith(discordPrefix)) {
		const cmd = content.slice(discordPrefix.length).split(/\s+/g)[0];

		if (cmd === 'help') {
			return channel.send(stripIndents`
					\`\`\`asciidoc
					=== Help doc ===

					[ Global command list ]
					${discordPrefix}ping       :: print the bot's ping
					${discordPrefix}tab        :: print the server's tab list
					${discordPrefix}entitylist :: list all entities within the bot's render distance
					${discordPrefix}xp         :: print the bot's XP stats
					${discordPrefix}var        :: print debugging variables

					[ Owner only commands ]
					${discordPrefix}lock       :: disconnect the bot from the server and prevent it from reconnecting
					${discordPrefix}reconnect  :: (disable the lock and) reconnect to the server
					${discordPrefix}eval       :: execute any JS code

					* Whitelisted users can send messages to the server chat (except the /kill command for obvious reasons)
					\`\`\`
				`);
		} else if (cmd === 'ping') {
			if (mcClient?.player?.ping)
				return channel.send(`Current ping: ${mcClient.player.ping}ms`);
			return channel.send('Could not access ping data!');
		} else if (cmd === 'tab') {
			if (mcClient?.players) {
				const players = Object.keys(mcClient.players)
					.map(p => `\`${p}\``)
					.sort();

				if (!players.length) return channel.send('No players were found.');

				const chunks = Array(Math.ceil(players.length / 100))
					.fill(0)
					.map((_, i) => players.slice(i * 100, i * 100 + 100));

				return chunks.map((chunk, index) => {
					const embed = new MessageEmbed()
						.setDescription(chunk.join(', '))
						.setColor('ORANGE');

					if (index === 0)
						embed.setTitle(`Tab list - ${players.length} player(s)`);

					return channel.send(embed);
				});
			}
			return channel.send('Could not access players object!');
		} else if (cmd === 'entitylist') {
			if (mcClient?.entities) {
				const entities: Record<string, number> = {};
				const entityList = Object.values(mcClient.entities);

				if (!entityList.length) return channel.send('No entities were found.');

				entityList.forEach(e => {
					const t =
						e.type === 'mob'
							? String(e.mobType)
							: e.type === 'object'
							? String(e.objectType)
							: String(e.type);

					if (!entities[t]) {
						entities[t] = 1;
					} else {
						entities[t]++;
					}
				});

				const formatted: string[] = [];

				Object.entries(entities).forEach(([type, count]) =>
					formatted.push(
						`• ${type[0].toUpperCase() + type.substring(1)} count: ${count}`
					)
				);

				const chunks = Array(Math.ceil(formatted.length / 15))
					.fill(0)
					.map((_, i) => formatted.slice(i * 15, i * 15 + 15));

				return chunks.map((chunk, index) => {
					const embed = new MessageEmbed()
						.setDescription(chunk.join('\n'))
						.setColor('ORANGE');

					if (index === 0)
						embed.setTitle(`Entity list - ${entityList.length} entity(s)`);

					return channel.send(embed);
				});
			}
			return channel.send('Could not access entities object!');
		} else if (cmd === 'xp') {
			if (
				Number.isNaN(mcClient?.experience?.level) ||
				Number.isNaN(mcClient?.experience?.points)
			)
				return channel.send(
					'Could not access `mc.experience` object or its properties!'
				);

			const percent = (mcClient.experience.progress * 100).toFixed(2);
			const embed = new MessageEmbed()
				.setTitle('XP Stats')
				.setDescription(
					stripIndents`
							• Current level: ${mcClient.experience.level.toLocaleString()} (${percent}% complete)
							• Total experience points: ${mcClient.experience.points.toLocaleString()}
						`
				)
				.setColor('ORANGE');

			return channel.send(embed);
		} else if (cmd === 'var') {
			return channel.send(
				codeBlock(
					stripIndents`
					${connected ? '++' : '--'} connected
					${disconnectLocked ? '++' : '--'} disconnectedLock
					${locked ? '++' : '--'} locked
				`,
					'diff'
				)
			);
		} else if (cmd === 'lock') {
			if (author.id !== ownerID) return channel.send('Permission denied.');

			locked = true;
			if (connected) mcClient.quit();

			console.log('Locked bot via chat command');

			return channel.send(
				'Locked the bot, it should now disconnect (given that it is connected).'
			);
		} else if (cmd === 'reconnect') {
			if (author.id !== ownerID) return channel.send('Permission denied.');

			locked = false;

			await channel.send('Reconnecting...');

			console.log('Reconnecting via chat command');

			if (connected) mcClient.quit();

			return undefined;
		} else if (cmd === 'eval') {
			if (author.id !== ownerID) return channel.send('Permission denied.');

			const code = content.slice(discordPrefix.length + 4);
			let hrDiff;
			try {
				const hrStart = process.hrtime();
				// eslint-disable-next-line no-eval
				lastResult = eval(code);
				hrDiff = process.hrtime(hrStart);
			} catch (err) {
				return channel.send(`\`\`\`js\n${err}\n\`\`\``);
			}

			const result = makeResultMessages(lastResult, hrDiff, code);
			if (Array.isArray(result)) return result.map(item => channel.send(item));
			return channel.send(result);
		}
	}

	if (!connected) return message.react('❌');

	if (!whitelistedUsers.includes(author.id) && author.id !== ownerID)
		return channel.send('You have to be whitelisted to send a message!');

	if (/^\/kill/i.test(content) && author.id !== ownerID)
		return channel.send('Permission denied.');

	mcClient.chat(content);
	return message.react('✅');
});

const init = async () => {
	await createWebhooks();
	console.log('Loaded all webhooks');

	await discordClient.login();

	await connectToMinecraft();
};

init();
