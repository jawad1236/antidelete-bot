const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeInMemoryStore,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys')

const CONFIG = {
  saveChats: true,
  saveGroups: false,
  saveStatus: false
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const store = makeInMemoryStore({})

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['AntiDel-Bot', 'Chrome', '1.0.0']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const jid = msg.key.remoteJid
    const isGroup = jid.endsWith('@g.us')
    const isStatus = jid === 'status@broadcast'

    const shouldSave =
      (!isGroup &&!isStatus && CONFIG.saveChats) ||
      (isGroup && CONFIG.saveGroups) ||
      (isStatus && CONFIG.saveStatus)

    if (shouldSave) {
      store.messages[jid] = store.messages[jid] || []
      store.messages[jid].push(msg)
      if (store.messages[jid].length > 200) store.messages[jid].shift()
    }
  })

  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (update.update.message === null || update.update.message === undefined) {
        const jid = update.key.remoteJid
        const isGroup = jid.endsWith('@g.us')

        if (!isGroup && CONFIG.saveChats) {
          const chatMsgs = store.messages[jid] || []
          const deletedMsg = chatMsgs.find(m => m.key.id === update.key.id)

          if (deletedMsg) {
            const sender = deletedMsg.key.participant || deletedMsg.key.remoteJid
            const senderNum = sender.split('@')[0]

            try {
              const type = Object.keys(deletedMsg.message)[0]
              const msgContent = deletedMsg.message[type]

              if (type === 'conversation' || type === 'extendedTextMessage') {
                let text = msgContent.text || msgContent
                await sock.sendMessage(jid, {
                  text: `🗑️ *Message supprimé par +${senderNum}*\n\n${text}`
                })
              }

              else if (['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage'].includes(type)) {
                const stream = await downloadContentFromMessage(msgContent, type.replace('Message', ''))

                let buffer = Buffer.from([])
                for await (const chunk of stream) {
                  buffer = Buffer.concat([buffer, chunk])
                }

                const mediaType = type.replace('Message', '').toLowerCase()
                await sock.sendMessage(jid, {
                  [mediaType]: buffer,
                  caption: `🗑️ *${mediaType} supprimé par +${senderNum}*`
                })
              }

            } catch (e) {
              await sock.sendMessage(jid, {
                text: `🗑️ *Média supprimé par +${senderNum}*\nImpossible de récupérer le fichier`
              })
            }
          }
        }
      }
    }
  })
}

startSock()