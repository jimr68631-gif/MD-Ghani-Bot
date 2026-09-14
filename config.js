export const config = {
  botName: "MD-Ghani-Bot",
  owner: ["919833010772@s.whatsapp.net"], // <- yahan apna number
  prefix: ".",
  channelJid: "120363429085670060@newsletter",
  channelLink: "https://whatsapp.com/channel/120363429085670060",
  pairingTimeout: 60000,
  browser: ["Ubuntu", "Chrome", "20.0.04"],
  alwaysOnline: true,
  sessionDir: "./sessions",
  timezone: "Asia/Karachi",
};

export const defaultToggles = {
  antibadword:false, antibot:false, antibug:false, anticontact:false,
  antidelete:false, antidemote:false, antipromote:false, antidocument:false,
  antiedit:false, antiforward:false, antigif:false, antiimage:false,
  antilink:false, antilocation:false, antimessage:false, antipoll:false,
  antistatus:false, antisticker:false, antitag:false, antitagadmin:false,
  antivideo:false, antiviewonce:false, antivoice:false, antistatuslinkkick:false,
  autoreact:false, autoseen:false, autoreactstatus:false,
  autorecording:false, autorecordtyping:false, autosavestatus:false,
  autotyping:false, autoviewstatus:false,
  alwaysonline:true, antilinkAction:"delete", antibadwordAction:"delete",
};