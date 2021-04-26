"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = __importDefault(require("util"));
const common_tags_1 = require("common-tags");
const discord_js_1 = require("discord.js");
const mineflayer_1 = __importDefault(require("mineflayer"));
const minecraft_protocol_1 = require("minecraft-protocol");
const constants_1 = require("./constants");
const discordClient = new discord_js_1.Client();
const webhooks = new discord_js_1.Collection();
let mcClient;
let ownerID;
let reconnectTimeout;
let connected = false;
let locked = false;
let disconnectLocked = false;
let lastResult = null;
const makeResultMessages = (result, hrDiff, input) => {
    const inspected = util_1.default.inspect(result, { depth: 0 }).replace(/!!NL!!/g, '\n');
    const split = inspected.split('\n');
    const last = inspected.length - 1;
    const prependPart = inspected[0] !== '{' && inspected[0] !== '[' && inspected[0] !== "'"
        ? split[0]
        : inspected[0];
    const appendPart = inspected[last] !== '}' &&
        inspected[last] !== ']' &&
        inspected[last] !== "'"
        ? split[split.length - 1]
        : inspected[last];
    const prepend = `\`\`\`js\n${prependPart}\n`;
    const append = `\n${appendPart}\n\`\`\``;
    if (input) {
        return discord_js_1.Util.splitMessage(common_tags_1.stripIndents `
				*Executed in ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.*
				\`\`\`js
				${inspected}
				\`\`\`
			`, { maxLength: 1900, prepend, append });
    }
    return discord_js_1.Util.splitMessage(common_tags_1.stripIndents `
				*Callback executed after ${hrDiff[0] > 0 ? `${hrDiff[0]}s ` : ''}${hrDiff[1] / 1000000}ms.*
				\`\`\`js
				${inspected}
				\`\`\`
			`, { maxLength: 1900, prepend, append });
};
const mapWebhooks = (obj, func = 'send') => {
    const promises = [];
    webhooks.map(hook => promises.push(hook[func](obj)));
    return Promise.all(promises);
};
const codeBlock = (str) => `\`\`\`\n${str.replace(/```/g, '\\`\\`\\`')}\n\`\`\``;
const getPlayerHead = (username) => `http://cravatar.eu/helmhead/${username}`;
const createWebhookMessage = (text, colour = 'BLURPLE', username = constants_1.mcServerAddress, avatarURL = constants_1.mcServerImage) => {
    return new discord_js_1.MessageEmbed()
        .setAuthor(username, avatarURL)
        .setDescription(codeBlock(text))
        .setColor(colour);
};
const createWebhooks = () => {
    const data = process.env.WEBHOOKS.split(',').map(str => str.split(':'));
    for (const obj of data)
        webhooks.set(obj[0], new discord_js_1.WebhookClient(obj[0], obj[1]));
    return mapWebhooks({ name: constants_1.mcServerAddress, avatar: constants_1.mcServerImage }, 'edit');
};
const checkServerStatus = util_1.default.promisify(minecraft_protocol_1.ping);
const checkHealth = async () => {
    const health = mcClient.health;
    const food = mcClient.food;
    const player = mcClient.player;
    const entities = mcClient.entities;
    if (!connected ||
        health === undefined ||
        food === undefined ||
        !player ||
        !entities)
        return;
    if (health > 19 && food > 8)
        return;
    locked = true;
    mcClient.quit();
    const otherPlayers = Object.values(entities)
        .filter(e => e.type === 'player' && e.username !== player.username)
        .map(e => e.username);
    console.log(`Autolog triggered at ${health} HP and ${food} hunger points.\n\nPlayers in render distance: ${otherPlayers
        .map(u => `\`${u}\``)
        .join(', ')}`);
    await mapWebhooks(createWebhookMessage(`Autolog triggered at ${health} HP and ${food} hunger points.\n\nPlayers in render distance: ${otherPlayers
        .map(u => `\`${u}\``)
        .join(', ')}`, 'RED', player.username, getPlayerHead(player.username)));
};
const connectToMinecraft = async () => {
    if (locked) {
        console.log('Not reconnecting due to lock');
        return mapWebhooks(createWebhookMessage('The bot has been locked. Use the reconnect command to reconnect to the server.'));
    }
    if (!disconnectLocked) {
        console.log(`Connecting to ${constants_1.mcServerAddress}`);
        await mapWebhooks(createWebhookMessage(`Connecting to ${constants_1.mcServerAddress}...`));
    }
    try {
        await checkServerStatus({ host: constants_1.mcServerAddress });
    }
    catch (err) {
        if (!disconnectLocked) {
            console.log(`${constants_1.mcServerAddress} is down`);
            console.log('Setting reconnect timeout of 10000ms');
            await mapWebhooks(createWebhookMessage(`${constants_1.mcServerAddress} is down, the bot will reconnect in the background.`, 'RED'));
        }
        disconnectLocked = true;
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectToMinecraft, 10000);
        return undefined;
    }
    mcClient = mineflayer_1.default.createBot({
        host: constants_1.mcServerAddress,
        username: String(process.env.MC_EMAIL),
        password: String(process.env.MC_PWD),
        hideErrors: false,
    });
    mcClient.on('spawn', async () => {
        connected = true;
        disconnectLocked = false;
        console.log('Spawned into minecraft world');
        await mapWebhooks(createWebhookMessage(`Logged into ${constants_1.mcServerAddress} as ${mcClient.player.username}`, 'BLURPLE', mcClient.player.username, getPlayerHead(mcClient.player.username)));
        checkHealth();
    });
    mcClient.on('health', checkHealth);
    mcClient.on('message', data => {
        const message = data.toString().trim();
        if (!message)
            return undefined;
        const joinLeave = message.match(/^\w{3,16} (?:joined|left) the game$/) || [];
        if (joinLeave.length)
            return mapWebhooks(createWebhookMessage(message, 'GREY'));
        const parsedMessage = message.match(/^<(\w{3,16})> (.+)$/) || [];
        if (parsedMessage[2]) {
            if (constants_1.whitelistedUsernames.includes(parsedMessage[1])) {
                // command stuff
            }
            return mapWebhooks(createWebhookMessage(parsedMessage[2], /^>/.test(parsedMessage[2]) ? 'GREEN' : [254, 254, 254], parsedMessage[1], getPlayerHead(parsedMessage[1])));
        }
        const server = message.match(/^\[server\] (.+)$/i) || [];
        if (server[1])
            return mapWebhooks(createWebhookMessage(server[1], 'ORANGE'));
        const colour = /^(?:\w{3,16} whispers: (.+)|To \w{3,16}: (.+))$/.test(message)
            ? [255, 0, 255]
            : [0, 170, 170];
        return mapWebhooks(createWebhookMessage(message, colour));
    });
    mcClient.on('end', () => {
        connected = false;
        if (!disconnectLocked) {
            console.log(`Disconnected from ${constants_1.mcServerAddress}`);
            console.log('Setting reconnect timeout of 10000ms');
            mapWebhooks(createWebhookMessage(`Disconnected from ${constants_1.mcServerAddress}.`, 'BLURPLE', mcClient.player.username, getPlayerHead(mcClient.player.username)));
        }
        if (reconnectTimeout)
            clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectToMinecraft, 10000);
    });
    return undefined;
};
discordClient.on('ready', async () => {
    console.log('Logged into Discord bot');
    const { owner } = await discordClient.fetchApplication();
    ownerID = owner.id;
});
discordClient.on('message', async (message) => {
    const { author, content, channel } = message;
    if (!constants_1.whitelistedChannels.includes(channel.id) || author.bot)
        return undefined;
    if (content.startsWith(constants_1.discordPrefix)) {
        const cmd = content.slice(constants_1.discordPrefix.length).split(/\s+/g)[0];
        if (cmd === 'help') {
            return channel.send(common_tags_1.stripIndents `
					\`\`\`asciidoc
					=== Help doc ===

					[ Global command list ]
					${constants_1.discordPrefix}ping       :: printthe bot's ping
					${constants_1.discordPrefix}tab        :: print the server's tab list
					${constants_1.discordPrefix}entitylist :: list all entities within the bot's render distance
					${constants_1.discordPrefix}xp         :: print the bot's XP stats
					${constants_1.discordPrefix}var        :: print debugging variables

					[ Owner only commands ]
					${constants_1.discordPrefix}lock       :: disconnect the bot from the server and prevent it from reconnecting
					${constants_1.discordPrefix}reconnect  :: (disable the lock and) reconnect to the server
					${constants_1.discordPrefix}eval       :: execute any JS code

					* Whitelisted users can send messages to the server chat (except the /kill command for obvious reasons)
					\`\`\`
				`);
        }
        else if (cmd === 'ping') {
            if (mcClient?.player?.ping)
                return channel.send(`Current ping: ${mcClient.player.ping}ms`);
            return channel.send('Could not access `mc.player.ping` property!');
        }
        else if (cmd === 'tab') {
            if (mcClient?.players) {
                const players = Object.keys(mcClient.players)
                    .map(p => `\`${p}\``)
                    .sort();
                if (!players.length)
                    return channel.send('No players were found.');
                const chunks = Array(Math.ceil(players.length / 100))
                    .fill(0)
                    .map((_, i) => players.slice(i * 100, i * 100 + 100));
                return chunks.map((chunk, index) => {
                    const embed = new discord_js_1.MessageEmbed()
                        .setDescription(chunk.join(', '))
                        .setColor('ORANGE');
                    if (index === 0)
                        embed.setTitle(`Tab list - ${players.length} player(s)`);
                    return channel.send(embed);
                });
            }
            return channel.send('Could not access `mc.players` object!');
        }
        else if (cmd === 'entitylist') {
            if (mcClient?.entities) {
                const entities = {};
                const entityList = Object.values(mcClient.entities);
                if (!entityList.length)
                    return channel.send('No entities were found.');
                entityList.forEach(e => {
                    const t = e.type === 'mob'
                        ? String(e.mobType)
                        : e.type === 'object'
                            ? String(e.objectType)
                            : String(e.type);
                    if (!entities[t]) {
                        entities[t] = 1;
                    }
                    else {
                        entities[t]++;
                    }
                });
                const formatted = [];
                Object.entries(entities).forEach(([type, count]) => formatted.push(`• ${type[0].toUpperCase() + type.substring(1)} count: ${count}`));
                const chunks = Array(Math.ceil(formatted.length / 15))
                    .fill(0)
                    .map((_, i) => formatted.slice(i * 15, i * 15 + 15));
                return chunks.map((chunk, index) => {
                    const embed = new discord_js_1.MessageEmbed()
                        .setDescription(chunk.join('\n'))
                        .setColor('ORANGE');
                    if (index === 0)
                        embed.setTitle(`Entity list - ${entityList.length} entity(s)`);
                    return channel.send(embed);
                });
            }
            return channel.send('Could not access `mc.entities` object!');
        }
        else if (cmd === 'xp') {
            if (Number.isNaN(mcClient?.experience?.level) ||
                Number.isNaN(mcClient?.experience?.points))
                return channel.send('Could not access `mc.experience` object or its properties!');
            const percent = (mcClient.experience.progress * 100).toFixed(2);
            const embed = new discord_js_1.MessageEmbed()
                .setTitle('XP Stats')
                .setDescription(common_tags_1.stripIndents `
							• Current level: ${mcClient.experience.level.toLocaleString()} (${percent}% complete)
							• Total experience points: ${mcClient.experience.points.toLocaleString()}
						`)
                .setColor('ORANGE');
            return channel.send(embed);
        }
        else if (cmd === 'var') {
            return channel.send(codeBlock(common_tags_1.stripIndents `
					${connected ? '++' : '--'} connected
					${disconnectLocked ? '++' : '--'} disconnectedLock
					${locked ? '++' : '--'} locked
				`));
        }
        else if (cmd === 'lock') {
            if (author.id !== ownerID)
                return channel.send('Permission denied.');
            locked = true;
            if (connected)
                mcClient.quit();
            console.log('Locked bot via chat command');
            return channel.send('Locked the bot, it should now disconnect (given that it is connected).');
        }
        else if (cmd === 'reconnect') {
            if (author.id !== ownerID)
                return channel.send('Permission denied.');
            locked = false;
            await channel.send('Reconnecting...');
            console.log('Reconnecting via chat command');
            if (connected)
                mcClient.quit();
            console.log('Setting reconnect timeout of 5000ms');
            if (reconnectTimeout)
                clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connectToMinecraft, 5000);
            return undefined;
        }
        else if (cmd === 'eval') {
            if (author.id !== ownerID)
                return channel.send('Permission denied.');
            const code = content.slice(constants_1.discordPrefix.length + 4);
            let hrDiff;
            try {
                const hrStart = process.hrtime();
                // eslint-disable-next-line no-eval
                lastResult = eval(code);
                hrDiff = process.hrtime(hrStart);
            }
            catch (err) {
                return channel.send(`\`\`\`js\n${err}\n\`\`\``);
            }
            const result = makeResultMessages(lastResult, hrDiff, code);
            if (Array.isArray(result))
                return result.map(item => channel.send(item));
            return channel.send(result);
        }
    }
    if (!connected)
        return message.react('❌');
    if (!constants_1.whitelistedUsers.includes(author.id) && author.id !== ownerID)
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