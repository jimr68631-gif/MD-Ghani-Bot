/* ============================================================
 *  MD-Ghani-Bot — gcstatus Command
 *  Kisi bhi message ko reply karke .gcstatus likho
 *  → Bot us cheez ko AAP KE SAARE groups ke status par
 *    ek saath laga dega.
 *
 *  Admin ho ya na ho — sab kaam karega (kyunki bot khud
 *  apne linked device se status post karta hai).
 * ============================================================ */

import { register } from "./_registry.js";
import { log } from "../lib/logger.js";

/* ------------------------------------------------------------
 *  Helper: Quoted message nikalo (reply wala)
 * ------------------------------------------------------------ */
function getQuotedMessage(msg) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo ||
    null;

  if (!ctx) return null;

  return {
    quotedMessage: ctx.quotedMessage || null,
    stanzaId: ctx.stanzaId || null,
    participant: ctx.participant || null,
  };
}

/* ------------------------------------------------------------
 *  Helper: Text / Media extract karo quoted message se
 * ------------------------------------------------------------ */
function extractContent(quotedMsg) {
  if (!quotedMsg) return null;

  // 1. Text
  if (quotedMsg.conversation) {
    return { type: "text", text: quotedMsg.conversation };
  }
  if (quotedMsg.extendedTextMessage?.text) {
    return { type: "text", text: quotedMsg.extendedTextMessage.text };
  }

  // 2. Image
  if (quotedMsg.imageMessage) {
    return {
      type: "image",
      media: quotedMsg.imageMessage,
      caption: quotedMsg.imageMessage.caption || "",
    };
  }

  // 3. Video
  if (quotedMsg.videoMessage) {
    return {
      type: "video",
      media: quotedMsg.videoMessage,
      caption: quotedMsg.videoMessage.caption || "",
    };
  }

  // 4. Audio (voice note)
  if (quotedMsg.audioMessage) {
    return {
      type: "audio",
      media: quotedMsg.audioMessage,
      ptt: quotedMsg.audioMessage.ptt || false,
    };
  }

  // 5. Document
  if (quotedMsg.documentMessage) {
    return {
      type: "document",
      media: quotedMsg.documentMessage,
      caption: quotedMsg.documentMessage.caption || "",
    };
  }

  // 6. Sticker
  if (quotedMsg.stickerMessage) {
    return { type: "sticker", media: quotedMsg.stickerMessage };
  }

  return null;
}

/* ------------------------------------------------------------
 *  Helper: Saare groups ki JID list nikalo
 * ------------------------------------------------------------ */
async function getAllGroupJids(sock) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Object.keys(groups || {});
  } catch (e) {
    log.error("gcstatus: groupFetchAllParticipating failed → " + e.message);
    return [];
  }
}

/* ------------------------------------------------------------
 *  Helper: Ek group ke participants ki JID list
 * ------------------------------------------------------------ */
async function getGroupParticipants(sock, groupJid) {
  try {
    const md = await sock.groupMetadata(groupJid);
    return (md.participants || []).map((p) => p.id);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------
 *  Helper: Status post karo (text / media)
 * ------------------------------------------------------------ */
async function postStatus(sock, content, statusJidList) {
  const opts = { statusJidList };

  if (content.type === "text") {
    return sock.sendMessage(
      "status@broadcast",
      { text: content.text, backgroundColor: "#7c5cff", font: 3 },
      opts
    );
  }

  if (content.type === "image") {
    return sock.sendMessage(
      "status@broadcast",
      {
        image: content.media,
        caption: content.caption,
      },
      opts
    );
  }

  if (content.type === "video") {
    return sock.sendMessage(
      "status@broadcast",
      {
        video: content.media,
        caption: content.caption,
      },
      opts
    );
  }

  if (content.type === "audio") {
    return sock.sendMessage(
      "status@broadcast",
      {
        audio: content.media,
        mimetype: "audio/mp4",
        ptt: content.ptt,
      },
      opts
    );
  }

  if (content.type === "document") {
    return sock.sendMessage(
      "status@broadcast",
      {
        document: content.media,
        caption: content.caption,
        mimetype: content.media.mimetype,
        fileName: content.media.fileName,
      },
      opts
    );
  }

  if (content.type === "sticker") {
    return sock.sendMessage(
      "status@broadcast",
      { sticker: content.media },
      opts
    );
  }

  throw new Error("Unsupported content type: " + content.type);
}

/* ============================================================
 *  REGISTER — .gcstatus
 * ============================================================ */
register("gcstatus", {
  toggle: null, // koi toggle nahi — always available

  run: async ({ sock, from, msg, sessionId }) => {
    try {
      /* -------- 1. Reply check -------- */
      const quoted = getQuotedMessage(msg);

      if (!quoted || !quoted.quotedMessage) {
        return sock.sendMessage(
          from,
          {
            text:
              "⚠️ *Usage:*\n\n" +
              "1️⃣ Jis cheez ko status par lagana hai, usay pehle kisi bhi chat mein bhejein.\n" +
              "2️⃣ Us message ko *Reply* karein aur likhein:\n" +
              "   *.gcstatus*\n\n" +
              "📌 Bot us cheez ko aap ke tamam groups ke status par laga dega.",
          },
          { quoted: msg }
        );
      }

      /* -------- 2. Content nikalo -------- */
      const content = extractContent(quoted.quotedMessage);

      if (!content) {
        return sock.sendMessage(
          from,
          {
            text: "❌ Ye content support nahi karta. Sirf text, image, video, audio, document ya sticker bhejein.",
          },
          { quoted: msg }
        );
      }

      /* -------- 3. Progress message -------- */
      const progressMsg = await sock.sendMessage(
        from,
        {
          text: "⏳ *gcstatus* chal raha hai...\n\n📋 Groups ki list ban rahi hai...",
        },
        { quoted: msg }
      );

      /* -------- 4. Saare groups lo -------- */
      const groupJids = await getAllGroupJids(sock);

      if (!groupJids.length) {
        return sock.sendMessage(from, {
          text: "❌ Bot kisi bhi group mein nahi hai.",
          edit: progressMsg.key,
        });
      }

      /* -------- 5. Sab participants ki JID list banao -------- */
      const statusJidList = [];
      for (const gJid of groupJids) {
        const participants = await getGroupParticipants(sock, gJid);
        statusJidList.push(...participants);
      }

      // Duplicate hatado
      const uniqueJids = [...new Set(statusJidList)];

      if (!uniqueJids.length) {
        return sock.sendMessage(from, {
          text: "❌ Koi participant nahi mila.",
          edit: progressMsg.key,
        });
      }

      /* -------- 6. Progress update -------- */
      await sock.sendMessage(from, {
        text: `⏳ *gcstatus* chal raha hai...\n\n📋 Groups: *${groupJids.length}*\n👥 Users: *${uniqueJids.length}*\n\n📤 Status post ho raha hai...`,
        edit: progressMsg.key,
      });

      /* -------- 7. Status post karo -------- */
      try {
        await postStatus(sock, content, uniqueJids);
      } catch (e) {
        log.error("gcstatus post failed: " + e.message);
        return sock.sendMessage(from, {
          text: `❌ Status post nahi ho saka.\n\n*Error:* ${e.message}`,
          edit: progressMsg.key,
        });
      }

      /* -------- 8. Success message -------- */
      await sock.sendMessage(from, {
        text:
          `✅ *gcstatus Complete!*\n\n` +
          `📋 Groups: *${groupJids.length}*\n` +
          `👥 Users: *${uniqueJids.length}*\n` +
          `📌 Type: *${content.type.toUpperCase()}*\n\n` +
          `> 💫 *MD-Ghani-Bot* — Always Fast ⚡`,
        edit: progressMsg.key,
      });
    } catch (e) {
      log.error("gcstatus error: " + e.message);
      try {
        await sock.sendMessage(from, {
          text: `❌ *gcstatus failed:*\n${e.message}`,
        });
      } catch {}
    }
  },
});