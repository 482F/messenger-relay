import fs from 'node:fs/promises'
import WebSocket, { WebSocketServer } from 'ws'
import crypto from 'node:crypto'

function makeSha256(plain: string) {
  const salt = '5E43f'
  return crypto
    .createHash('sha256')
    .update(plain + salt, 'utf-8')
    .digest('hex')
}

const defaultInfo = {
  port: 0,
  key: '',
  cert: '',
  passwordHash: '',
}
type Info = typeof defaultInfo
const info: unknown = JSON.parse(await fs.readFile('info.json', 'utf-8'))

function isInfo(data: unknown): data is Info {
  if (!data || typeof data !== 'object') {
    return false
  }
  const info = data as Info
  const keys = Object.keys(info)
  const defaultKeys = Object.keys(defaultInfo)
  const allKeys = [...new Set([...keys, ...defaultKeys])]
  if (keys.length !== allKeys.length) {
    return false
  }

  for (const _key of allKeys) {
    const key = _key as keyof Info
    if (typeof info[key] !== typeof defaultInfo[key]) {
      return false
    }
  }
  return true
}

if (!isInfo(info)) {
  throw new Error('info.json の中身が不正です')
}

const server = await (async () => {
  if (process.env.RUN_HTTP === 'true') {
    const http = await import('node:http').then((m) => m.default)
    return http.createServer()
  } else {
    const https = await import('https')
    const options = {
      key: await fs.readFile(info.key),
      cert: await fs.readFile(info.cert),
    }
    return https.createServer(options)
  }
})()

const wss = new WebSocketServer({ server })

const clients: { [hex: string]: WebSocket.WebSocket } = {}

wss.on('connection', async function (currentWs, req) {
  const isPasswordCorrect = await new Promise((resolve) => {
    currentWs.addEventListener('message', (e) => {
      const message = e.data.toString()
      const expectedMessage = `password: ${info.passwordHash}`

      resolve(message === expectedMessage)
    })
  })
  if (!isPasswordCorrect) {
    currentWs.close()
    return
  }

  currentWs.send(JSON.stringify({ sender: 'server', message: 'authenticated' }))

  const ip = req.socket.remoteAddress
  const id = makeSha256(ip ?? '') + Math.random()
  clients[id] = currentWs

  currentWs.on('message', function (rawData, isBinary) {
    const message = isBinary ? rawData : rawData.toString()
    const payloadObj = {
      sender: id,
      message,
    }
    const payload = JSON.stringify(payloadObj)
    for (const ws of Object.values(clients)) {
      if (ws === currentWs) {
        continue
      }
      ws.send(payload)
    }
  })
  currentWs.addEventListener('close', function () {
    delete clients[id]
  })
})

server.listen(info.port)
console.log('ready')
