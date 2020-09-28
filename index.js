'use strict';

const util = require('util');
const tags = require('common-tags');
const { Client, MessageEmbed, splitMessage, WebhookClient } = require('discord.js');
const mineflayer = require('mineflayer');
const users = new Set(JSON.parse(process.env.WHITELISTED_USERS));
const channels = new Set(JSON.parse(process.env.WHITELISTED_CHANNELS));
const hooks = [];
for (const { id, token } of JSON.parse(process.env.WEBHOOKS)) hooks.push(new WebhookClient(id, token));
let mc, bot, ownerID, timeout, lock = false, dcLock = false, lastResult = null;

const codeBlock = str => `\`\`\`\n${str.replace(/`/g, '\\`')}\n\`\`\``;
const log = str => console.log(`[${new Date()}] ${str}`);
const ping = require('util').promisify(require('minecraft-protocol').ping);

const exec = (obj, func = 'send') => {
	const promises = [];
	for (const hook of hooks) promises.push(hook[func](obj));
	return Promise.all(promises);
};

const checkHealth = async () => {
	if (mc.health === undefined || mc.food === undefined) return;
	if (mc.health > 19 && mc.food > 8) return;

	try {
		await exec({
			embeds: [new MessageEmbed()
				.setDescription(codeBlock`Quitting with ${mc.health} health and ${mc.food} hunger points.`)
				.setColor('RED')],
			username: mc.username,
			avatarURL: `http://cravatar.eu/helmhead/${mc.username}/256.png`,
		});
		// eslint-disable-next-line no-empty
	} catch (e) {}

	log(`Logged out at ${mc.health} hp and ${mc.food} saturation!`);
	lock = true;
	mc.quit();
};

const makeResultMessages = (result, hrDiff, input = null) => {
	const inspected = util.inspect(result, { depth: 0 })
		.replace(/!!NL!!/g, '\n');
	const split = inspected.split('\n');
	const last = inspected.length - 1;
	const prependPart = inspected[0] !== '{' && inspected[0] !== '[' && inspected[0] !== '\'' ? split[0] : inspected[0];
	const appendPart = inspected[last] !== '}' && inspected[last] !== ']' && inspected[last] !== '\'' ?
		split[split.length - 1] :
		inspected[last];
	const prepend = `\`\`\`js\n${prependPart}\n`;
	const append = `\n${appendPart}\n\`\`\``;

	if (input) {
		return splitMessage(tags.stripIndents`
				*Executed in ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.*
				\`\`\`js
				${inspected}
				\`\`\`
			`, { maxLength: 1900, prepend, append });
	} else {
		return splitMessage(tags.stripIndents`
				*Callback executed after ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.*
				\`\`\`js
				${inspected}
				\`\`\`
			`, { maxLength: 1900, prepend, append });
	}
};

const connectToHost = async () => {
	log(`Connecting to ${process.env.MC_HOST}`);

	if (lock === true) return log('Aborting connection');

	try {
		await ping({ host: process.env.MC_HOST });
	} catch (err) {
		if (!dcLock) {
			dcLock = true;
			log(`${process.env.MC_HOST} is down. Reconnecting in 10 seconds...`);

			try {
				await exec(new MessageEmbed()
					.setDescription(`${process.env.MC_HOST} is down. The bot will attempt to reconnect in the background.`)
					.setColor('RED'));
			// eslint-disable-next-line no-empty
			} catch (e) {}
		}

		timeout = setTimeout(connectToHost, 10000);
	}

	mc = mineflayer.createBot({
		host: process.env.MC_HOST,
		username: process.env.MC_EMAIL,
		password: process.env.MC_PWD,
		hideErrors: true,
	});

	mc.on('login', async () => {
		log(`Logged into ${process.env.MC_HOST} as ${mc.username}.`);
		dcLock = false;

		try {
			await exec({
				embeds: [new MessageEmbed()
					.setDescription(`Logged into ${process.env.MC_HOST} as \`${mc.username}\`.`)
					.setColor('BLURPLE')],
				username: mc.username,
				avatarURL: `http://cravatar.eu/helmhead/${mc.username}256.png`,
			});
		// eslint-disable-next-line no-empty
		} catch (e) {}
	});

	mc.on('spawn', checkHealth);
	mc.on('health', checkHealth);

	mc.on('message', async d => {
		const str = d.toString().trim();
		if (!str) return;

		const joinLeave = str.match(/^\w{1,16} (?:joined|left) the game$/) || [];
		if (joinLeave.length) {
			try {
				await exec({
					username: process.env.HOST_NAME,
					embeds: [new MessageEmbed().setColor('GREY').setDescription(codeBlock(str))],
				});
			// eslint-disable-next-line no-empty
			} catch (e) {}
			return;
		}

		const message = str.match(/^<(\w{1,16})> (.+)$/) || [];
		if (message[2]) {
			try {
				await exec({
					embeds: [new MessageEmbed().setDescription(codeBlock(message[2]))
						.setColor(/^>/.test(message[2]) ? [0, 255, 0] : [254, 254, 254])],
					username: message[1],
					avatarURL: `http://cravatar.eu/helmhead/${message[1]}/256.png`,
				});
			// eslint-disable-next-line no-empty
			} catch (e) {}
			return;
		}

		try {
			await exec({
				embeds: [new MessageEmbed()
					.setDescription(codeBlock(str))
					.setColor([0, 170, 170])],
				username: process.env.MC_HOST,
			});
		// eslint-disable-next-line no-empty
		} catch (e) {}
	});

	mc.on('end', async () => {
		mc = undefined;
		log(`Disconnected from ${process.env.MC_HOST}`);

		try {
			await exec({
				embeds: [new MessageEmbed()
					.setDescription(`Disconnected from ${process.env.MC_HOST}`)
					.setColor('BLURPLE')],
				username: process.env.MC_HOST,
				avatarURL: process.env.MC_HOST_IMG,
			});
		// eslint-disable-next-line no-empty
		} catch (e) {}

		timeout = setTimeout(connectToHost, 10000);
	});

	return undefined;
};

const login = async () => {
	bot = new Client({ retryLimit: 0 });

	try {
		await exec({ name: process.env.MC_HOST, avatar: process.env.MC_HOST_IMG }, 'edit');
		await bot.login();
	} catch (err) {
		log('Failed to log in/edit webhooks, retrying in 30 seconds...');
		if (bot) bot.destroy();

		return setTimeout(login, 30000);
	}

	bot.on('ready', async () => {
		log(`Logged into Discord as ${bot.user.tag} (${bot.user.id})`);

		try {
			const { owner } = await bot.fetchApplication();
			ownerID = owner.id;
		} catch (err) {
			log(`Failed to fetch bot owner. Logging in again in 30 seconds...`);

			bot.destroy();
			return setTimeout(login, 30000);
		}

		return connectToHost();
	});

	bot.on('message', msg => {
		if (!channels.has(msg.channel.id) || !msg.content || msg.author.bot) return;

		try {
			if (msg.content.startsWith(process.env.DISCORD_PREFIX)) {
				const cmd = msg.content.slice(process.env.DISCORD_PREFIX.length).split(/\s+/g)[0];
				if (cmd === 'tab') {
					const players = Object.keys(mc.players).map(p => `\`${p}\``).sort();
					const chunks = Array(Math.ceil(players.length / 100))
						.fill()
						.map((_, i) => players.slice(i * 100, (i * 100) + 100));

					chunks.map((chunk, index) => {
						const embed = new MessageEmbed()
							.setDescription(chunk.join(', '))
							.setColor('GREY');

						if (index === 0) embed.setTitle(`Tab list - ${players.length} player(s)`);

						return msg.channel.send(embed);
					});
					return;
				} else if (cmd === 'entitylist') {
					const mobTypes = new Set();
					const values = Object.values(mc.entities);
					values.map(e => mobTypes.add(e.mobType || e.objectType || e.type[0].toUpperCase() + e.type.substring(1)));
					const formatted = Array
						.from(mobTypes.values())
						.map(name =>
							`• ${name} count: ${values.filter(e =>
								(e.mobType || e.objectType || e.type[0].toUpperCase() + e.type.substring(1)) === name,
							).length}`,
						);
					const chunks = Array(Math.ceil(formatted.length / 15))
						.fill()
						.map((_, i) => formatted.slice(i * 15, (i * 15) + 15));

					chunks.map((chunk, index) => {
						const embed = new MessageEmbed()
							.setDescription(chunk.join('\n'))
							.setColor('GREY');

						if (index === 0) embed.setTitle(`Entity list - ${values.length} entity(s)`);

						return msg.channel.send(embed);
					});
					return;
				} else if (cmd === 'lock') {
					if (msg.author.id !== ownerID) {
						msg.channel.send('Permission denied.');
						return;
					}
					lock = true;

					if (mc) mc.quit();
					if (timeout) clearTimeout(timeout);

					msg.channel.send('Locked the bot, it should now disconnect.');
					return;
				} else if (cmd === 'reconnect') {
					if (msg.author.id !== ownerID) {
						msg.channel.send('Permission denied.');
						return;
					}
					lock = false;
					if (mc) mc.quit();
					if (timeout) clearTimeout(timeout);

					msg.channel.send('Reconnecting...');
					connectToHost();
					return;
				} else if (cmd === 'eval') {
					if (msg.author.id !== ownerID) {
						msg.channel.send('Permission denied.');
						return;
					}

					const code = msg.content.slice(process.env.DISCORD_PREFIX.length + 4);
					let hrDiff;
					try {
						const hrStart = process.hrtime();
						lastResult = eval(code);
						hrDiff = process.hrtime(hrStart);
					} catch (err) {
						msg.channel.send(`\`\`\`js\n${err}\n\`\`\``);
						return;
					}

					const result = makeResultMessages(lastResult, hrDiff, code);
					if (Array.isArray(result)) {
						result.map(item => msg.channel.send(item));
					} else {
						msg.channel.send(result);
					}
					return;
				}
			}

			if (!mc || !mc.game) return;
			if (!users.has(msg.author.id) && msg.author.id !== ownerID) {
				msg.channel.send('You have to be whitelisted to send a message!');
				return;
			}
			if (msg.content.startsWith('/kill') && msg.author.id !== ownerID) {
				msg.channel.send('Permission denied.');
				return;
			}

			mc.chat(msg.content);
		} catch (err) {
			msg.channel.send(`An error has occurred\n\n\`\`\`js\n${err.stack}\n\`\`\``);
		}
	});

	return undefined;
};

login();

const server = require('http').createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
}).listen(3000);
