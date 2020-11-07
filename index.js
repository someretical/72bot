'use strict';

const util = require('util');
const tags = require('common-tags');
const { Client, MessageEmbed, splitMessage, WebhookClient } = require('discord.js');
const mineflayer = require('mineflayer');
const users = new Set(JSON.parse(process.env.WHITELISTED_USERS));
const channels = new Set(JSON.parse(process.env.WHITELISTED_CHANNELS));
const hooks = JSON.parse(process.env.WEBHOOKS).map(hook => new WebhookClient(hook.id, hook.token));

const codeBlock = str => `\`\`\`\n${str.replace(/`/g, '\\`')}\n\`\`\``;
const log = str => console.log(`[${new Date()}] ${str}`);
const ping = require('util').promisify(require('minecraft-protocol').ping);
const exec = (obj, func = 'send') => {
	const promises = [];
	hooks.map(hook => promises.push(hook[func](obj)));
	return Promise.all(promises);
};

let mc,
	bot,
	ownerID,
	timeout,
	connected = false,
	lock = false,
	dcLock = false,
	lastResult = null;


const checkHealth = async () => {
	if (!mc || Number.isNaN(mc.health) || Number.isNaN(mc.food)) return;
	if (mc.health > 19 && mc.food > 8) return;

	try {
		await exec({
			embeds: [new MessageEmbed()
				.setDescription(codeBlock`Quitting with ${mc.health} HP and ${mc.food} hunger.`)
				.setColor('RED')],
			username: mc.username,
			avatarURL: `http://cravatar.eu/helmhead/${mc.username}/256.png`,
		});
	} catch (e) {
		log(e);
	}

	log(`Logged out at ${mc.health} hp and ${mc.food} hunger!`);
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
	if (!dcLock) log(`Connecting to ${process.env.MC_HOST}...`);
	if (timeout) clearTimeout(timeout);
	if (lock === true) return log('Aborting connection due to active lock!');

	try {
		await ping({ host: process.env.MC_HOST });
	} catch (err) {
		if (!dcLock) {
			dcLock = true;
			log(`${process.env.MC_HOST} is down. The bot will attempt to reconnect in the background.`);

			try {
				await exec(new MessageEmbed()
					.setDescription(`${process.env.MC_HOST} is down. The bot will attempt to reconnect in the background.`)
					.setColor('RED'));
			} catch (e) {
				log(e);
			}
		}

		timeout = setTimeout(connectToHost, 10000);
		return undefined;
	}

	mc = mineflayer.createBot({
		host: process.env.MC_HOST,
		username: process.env.MC_EMAIL,
		password: process.env.MC_PWD,
		hideErrors: false,
	});

	mc.on('login', async () => {
		log(`Logged into ${process.env.MC_HOST} as ${mc.username}.`);
		connected = true;
		dcLock = false;

		try {
			await exec({
				embeds: [new MessageEmbed()
					.setDescription(`Logged into ${process.env.MC_HOST} as \`${mc.username}\`.`)
					.setColor('BLURPLE')],
				username: mc.username,
				avatarURL: `http://cravatar.eu/helmhead/${mc.username}/256.png`,
			});
		} catch (e) {
			log(e);
		}
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
			} catch (e) {
				log(e);
			}
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
			} catch (e) {
				log(e);
			}
			return;
		}

		const server = str.match(/^\[server\] (.+)$/i) || [];
		if (server[1]) {
			try {
				await exec({ embeds: [new MessageEmbed().setDescription(codeBlock(server[1])).setColor('ORANGE')] });
			} catch (e) {
				log(e);
			}
			return;
		}

		try {
			await exec({
				embeds: [new MessageEmbed()
					.setDescription(codeBlock(str))
					.setColor([0, 170, 170])],
				username: process.env.MC_HOST,
			});
		} catch (e) {
			log(e);
		}
	});

	mc.on('end', async () => {
		connected = false;
		log(`Disconnected from ${process.env.MC_HOST}`);

		try {
			await exec({
				embeds: [new MessageEmbed()
					.setDescription(`Disconnected from ${process.env.MC_HOST}`)
					.setColor('BLURPLE')],
				username: process.env.MC_HOST,
				avatarURL: process.env.MC_HOST_IMG,
			});
		} catch (e) {
			log(e);
		}

		timeout = setTimeout(connectToHost, 10000);
	});

	return undefined;
};

const login = async () => {
	bot = new Client({ retryLimit: 0 });

	try {
		// Await exec({ name: process.env.MC_HOST, avatar: process.env.MC_HOST_IMG }, 'edit');
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

		if (msg.content.startsWith(process.env.DISCORD_PREFIX)) {
			const cmd = msg.content.slice(process.env.DISCORD_PREFIX.length).split(/\s+/g)[0];
			if (cmd === 'ping') {
				if (!mc || !mc.player || mc.player.ping === undefined) {
					msg.channel.send('Could not access `mc.player.ping` property!');
					return;
				}

				msg.channel.send(`Current ping: ${mc.player.ping}ms`);
				return;
			} else if (cmd === 'tab') {
				if (!mc || !mc.players) {
					msg.channel.send('Could not access `mc.players` object!');
					return;
				}

				const players = Object.keys(mc.players).map(p => `\`${p}\``).sort();

				if (!players.length) {
					msg.channel.send('No players were found.');
					return;
				}

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
				if (!mc || !mc.entities) {
					msg.channel.send('Could not access `mc.entities` object!');
					return;
				}

				const entities = {};
				const entityList = Object.values(mc.entities);

				if (!entityList.length) {
					msg.channel.send('No entities were found.');
					return;
				}

				entityList.forEach(e => {
					const t = e.type === 'mob' ? e.mobType :
						e.type === 'object' ? e.objectType : e.type.toString();

					if (!entities[t]) {
						entities[t] = 1;
					} else {
						entities[t]++;
					}
				});

				const formatted = [];
				for (const type in entities) {
					formatted.push(`• ${type[0].toUpperCase() + type.substring(1)} count: ${entities[type]}`);
				}

				const chunks = Array(Math.ceil(formatted.length / 15))
					.fill()
					.map((_, i) => formatted.slice(i * 15, (i * 15) + 15));

				chunks.map((chunk, index) => {
					const embed = new MessageEmbed()
						.setDescription(chunk.join('\n'))
						.setColor('GREY');

					if (index === 0) embed.setTitle(`Entity list - ${entityList.length} entity(s)`);

					return msg.channel.send(embed);
				});
				return;
			} else if (cmd === 'xp') {
				if (!mc || !mc.experience || Number.isNaN(mc.experience.level) || Number.isNaN(mc.experience.points)) {
					msg.channel.send('Could not access `mc.experience` object or its properties!');
					return;
				}

				const percent = (mc.experience.progress * 100).toFixed(2);
				const embed = new MessageEmbed()
					.setTitle('XP Stats')
					.setDescription(tags.stripIndents`
						• Current level: ${mc.experience.level.toLocaleString()} (${percent}% complete)
						• Total experience points: ${mc.experience.points.toLocaleString()}
					`)
					.setColor('GREY');

				msg.channel.send(embed);
				return;
			} else if (cmd === 'lock') {
				if (msg.author.id !== ownerID) {
					msg.channel.send('Permission denied.');
					return;
				}
				lock = true;

				if (connected) mc.quit();
				msg.channel.send('Locked the bot, it should now disconnect (given that it is connected).');
				return;
			} else if (cmd === 'reconnect') {
				if (msg.author.id !== ownerID) {
					msg.channel.send('Permission denied.');
					return;
				}

				msg.channel.send('Reconnecting...');
				lock = false;

				if (connected) mc.quit();
				if (timeout) clearTimeout(timeout);
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

		if (!connected) {
			msg.react('❌');
			return;
		}

		if (!users.has(msg.author.id) && msg.author.id !== ownerID) {
			msg.channel.send('You have to be whitelisted to send a message!');
			return;
		}

		if (/^\/kill/i.test(msg.content) && msg.author.id !== ownerID) {
			msg.channel.send('Permission denied.');
			return;
		}

		mc.chat(msg.content);
	});

	return undefined;
};

login();
