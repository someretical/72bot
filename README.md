# 72bot
Discord &lt;-> Minecraft chatbridge for AFK purposes

Feel free to self host if you know how to make it work

## Environment configuration values
```ini
# discord
WEBHOOKS=id:token,id2:token2
DISCORD_TOKEN=

# minecraft
MC_EMAIL=
MC_PWD=
```

## Create http server
```js
const server = require('http').createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
}).listen(3000);
```
