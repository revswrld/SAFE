require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
const https = require('https');
const PDFDocument = require('pdfkit');


const client = new Client();
const archiveDir = './cases_archive';
const logsDir = './logs';
const casesDir = './cases';
const watchlistPath = './watchlist.json';
const blacklistPath = './blacklist.json';
const keywordsPath = './keywords.json';

function generateLogId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function resolveUserIdFromUsername(usernameInput) {
  const files = fs.readdirSync(casesDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(casesDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const latest = Array.isArray(data) ? data[data.length - 1] : null;
      if (latest?.username?.toLowerCase() === usernameInput.toLowerCase()) {
        return file.replace('.json', '');
      }
    } catch {}
  }
  return null;
}
const watchlistFile = './watchlist.json';  // file to store watchlisted user IDs
const watchlistWebhookUrl = process.env.WATCHLIST_WEBHOOK_URL;

const webhookHighUrl = process.env.WEBHOOK_HIGH;
const webhookMediumUrl = process.env.WEBHOOK_MEDIUM;
const webhookLowUrl = process.env.WEBHOOK_LOW;

const suggestedKeywordsFile = './suggested_keywords.json';
const keywordReviewUserId = '1002739977181995080';

const { lowRisk, mediumRisk, highRisk } = require('./keywords');

// Ensure base directories exist
[logsDir, casesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Load watchlist from file or return empty array
function loadWatchlist() {
  if (!fs.existsSync(watchlistFile)) return [];
  try {
    const raw = fs.readFileSync(watchlistFile, 'utf8').trim();
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Save watchlist array to file
function saveWatchlist(list) {
  fs.writeFileSync(watchlistFile, JSON.stringify(list, null, 2));
}

// Store flagged messages under user ID
function logFlaggedMessage(data) {
  const userFile = path.join(casesDir, `${data.userId}.json`);
  let existing = [];
  if (fs.existsSync(userFile)) {
    try {
      const raw = fs.readFileSync(userFile, 'utf8').trim();
      if (raw.length) existing = JSON.parse(raw);
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
  }
  existing.push(data);
  fs.writeFileSync(userFile, JSON.stringify(existing, null, 2));
}

// Send flagged messages to risk-based webhook
function sendToWebhook(data) {
  let url;
  if (data.risk === "high") url = webhookHighUrl;
  else if (data.risk === "medium") url = webhookMediumUrl;
  else if (data.risk === "low") url = webhookLowUrl;
  else return;

  if (!url) return;

  const timestampEpoch = Math.floor(new Date(data.timestamp || `${data.date} ${data.time}`).getTime() / 1000);

  const payload = {
    embeds: [{
      title: "⚠️ Flagged Message",
      color: data.risk === "high" ? 0xff0000 : data.risk === "medium" ? 0xffa500 : 0xffff00,
      fields: [
        { name: "User", value: `${data.username} (${data.userId})`, inline: true },
        { name: "Server", value: data.guildName || "Unknown", inline: true },
        { name: "Time", value: `<t:${timestampEpoch}:F>`, inline: true },
        { name: "Risk Level", value: data.risk.toUpperCase(), inline: true },
        { name: "Matched Keywords", value: data.matched.join(', ') || "None" },
        { name: "Message Content", value: (data.content.length > 1024 ? data.content.slice(0, 1021) + '...' : data.content) || "*Empty*" },
        { name: "Jump Link", value: `[Click to view](${data.link})` }
      ],
      timestamp: new Date()
    }]
  };

  const req = https.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, res => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`Webhook post failed with status code: ${res.statusCode}`);
    }
  });

  req.on('error', err => {
    console.error('Webhook post error:', err);
  });

  req.write(JSON.stringify(payload));
  req.end();
}

const blacklistFile = './blacklist.json';

function loadBlacklist() {
  if (!fs.existsSync(blacklistFile)) return [];
  try {
    const raw = fs.readFileSync(blacklistFile, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveBlacklist(list) {
  fs.writeFileSync(blacklistFile, JSON.stringify(list, null, 2));
}


// Send watchlist messages to watchlist webhook with distinct embed style
function sendWatchlistWebhook(data) {
  if (!watchlistWebhookUrl) return;

  const timestampEpoch = Math.floor(new Date(data.timestamp || `${data.date} ${data.time}`).getTime() / 1000);

  const payload = {
    embeds: [{
      title: "👁️ Watchlist Alert",
      color: 0x1E90FF, // DodgerBlue color for watchlist
      fields: [
        { name: "User", value: `${data.username} (${data.userId})`, inline: true },
        { name: "Server", value: data.guildName || "Unknown", inline: true },
        { name: "Time", value: `<t:${timestampEpoch}:F>`, inline: true },
        { name: "Matched Keywords", value: data.matched.join(', ') || "None" },
        { name: "Message Content", value: (data.content.length > 1024 ? data.content.slice(0, 1021) + '...' : data.content) || "*Empty*" },
        { name: "Jump Link", value: `[Click to view](${data.link})` },
        { name: "Note", value: "User is on the Watchlist.", inline: false }
      ],
      timestamp: new Date()
    }]
  };

  const req = https.request(watchlistWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, res => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`Watchlist webhook post failed with status code: ${res.statusCode}`);
    }
  });

  req.on('error', err => {
    console.error('Watchlist webhook post error:', err);
  });

  req.write(JSON.stringify(payload));
  req.end();
}
const ignoredServersFile = './ignored_servers.json';

function loadIgnoredServers() {
  if (!fs.existsSync(ignoredServersFile)) return [];
  try {
    const raw = fs.readFileSync(ignoredServersFile, 'utf8').trim();
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveIgnoredServers(list) {
  fs.writeFileSync(ignoredServersFile, JSON.stringify(list, null, 2));
}

// Risk keyword check
function checkFlags(message) {
  if (!message || typeof message !== 'string') return { matched: [], risk: "none" };

  const msgTrimmed = message.trim();
  const msgLower = msgTrimmed.toLowerCase();

  // Check for exact blacklisted phrases
  const blacklistedPhrases = loadBlacklist().map(p => p.toLowerCase().trim());
  if (blacklistedPhrases.some (phrase => msgLower.includes(phrase))) {
    return { matched: [], risk: "none" };
  }

  // Skip false positive patterns
  const ignorePatterns = ['gif', '.com', 'nigg', 'l.'];
  if (ignorePatterns.some(p => msgLower.includes(p))) {
    return { matched: [], risk: "none" };
  }

  // Match risk keywords
  const matched = { low: [], medium: [], high: [] };

  for (const word of lowRisk) {
    if (msgLower.includes(word)) matched.low.push(word);
  }
  for (const word of mediumRisk) {
    if (msgLower.includes(word)) matched.medium.push(word);
  }
  for (const word of highRisk) {
    if (msgLower.includes(word)) matched.high.push(word);
  }

  // Determine overall risk
  let risk = "none";
  if (matched.high.length) risk = "high";
  else if (matched.medium.length) risk = "medium";
  else if (matched.low.length) risk = "low";

  // Combine all matched keywords
  const allMatched = [...matched.high, ...matched.medium, ...matched.low];

  return { matched: allMatched, risk };
}

// Get list of server folders for .request
function getLoggedServers() {
  if (!fs.existsSync(logsDir)) return [];
  return fs.readdirSync(logsDir).filter(f => {
    return fs.statSync(path.join(logsDir, f)).isDirectory();
  });
}

// Send message logs file for server
async function sendLogs(msg, serverFolder) {
  const logPath = path.join(logsDir, serverFolder, 'messages.txt');
  if (!fs.existsSync(logPath)) {
    await msg.channel.send(`No logs found for server folder \`${serverFolder}\`.`);
    return;
  }
  await msg.channel.send({ files: [logPath] });
}

async function getMutualGuilds(client, userId) {
  const mutualGuilds = [];

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) mutualGuilds.push(guild.name);
    } catch {
      // Ignore errors silently
    }
  }

  return mutualGuilds;
}

async function watchlistWithTwoOrMoreMutuals(client, watchlistPath) {
  console.log('Checking watchlist users for mutual servers...');

  if (!fs.existsSync(watchlistPath)) return [];

  let watchlist = [];
  try {
    watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
    if (!Array.isArray(watchlist)) watchlist = [];
  } catch {
    console.error('Error reading watchlist.json');
    return [];
  }

  const results = [];

  let checkedCount = 0;
  for (const userId of watchlist) {
    checkedCount++;
    console.log(`Checking watchlisted user ${checkedCount}/${watchlist.length}: ${userId}`);

    let usernameTag = null;
    let mutualCount = 0;

    for (const [guildId, guild] of client.guilds.cache) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          mutualCount++;
          if (!usernameTag) usernameTag = member.user.tag;
          if (mutualCount >= 2) break;
        }
      } catch {}
    }

    if (mutualCount >= 2) {
      results.push({ userId, usernameTag: usernameTag || 'Unknown', mutualCount });
    }
  }

  console.log(`Finished checking watchlisted users. Found ${results.length} with 2+ mutual servers.`);
  return results;
}

// Get how many mutual guilds the client shares with a userId
async function flaggedWithTwoOrMoreMutuals(client, casesPath) {
  console.log('Starting to check flagged users for mutual servers...');

  const flaggedFiles = fs.readdirSync(casesPath).filter(f => f.endsWith('.json'));
  console.log(`Found ${flaggedFiles.length} flagged user files.`);

  const flaggedUserIds = flaggedFiles.map(f => f.replace('.json', ''));

  const results = [];

  let checkedCount = 0;
  for (const userId of flaggedUserIds) {
    checkedCount++;
    console.log(`Checking user ${checkedCount}/${flaggedUserIds.length}: ${userId}`);

    let usernameTag = null;
    let mutualCount = 0;

    try {
      // Count mutual guilds and get username from first mutual guild where member found
      for (const [guildId, guild] of client.guilds.cache) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            mutualCount++;
            if (!usernameTag) usernameTag = member.user.tag;
            if (mutualCount >= 2) break;
          }
        } catch {}
      }
    } catch (e) {
      console.log(`Error fetching member ${userId}:`, e);
    }

    console.log(`  Mutual servers found: ${mutualCount}`);

    if (mutualCount >= 2) {
      results.push({ userId, usernameTag: usernameTag || 'Unknown', mutualCount });
      console.log(`  User ${userId} (${usernameTag || 'Unknown'}) added to results.`);
    }
  }

  console.log(`Finished checking flagged users. Found ${results.length} with 2 or more mutual servers.`);
  return results;
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.username}`);
});

client.on('messageCreate', async (msg) => {
  // Ignore bots always
  if (msg.author.bot) return;

  if (msg.guild) {
    const mainServerId = '1394339217055678586';
    if (msg.guild.id !== mainServerId) {
      if (msg.content.startsWith('.')) return; // ignore commands outside main server
  };

  // Load current watchlist for quick access
  const watchlist = loadWatchlist();

  // === HANDLE MESSAGES IN GUILDS (LOGGING, FLAGGING, COMMANDS) ===
  if (msg.guild) {
    const existingFolders = fs.readdirSync(logsDir);

// Try to find an existing folder for this guild (based on guild name)
const sanitize = (name) => name.replace(/[<>:"/\\|?*]/g, '');

let folderName = existingFolders.find(f => {
  // Match against sanitized name in existing folder names
  return f.split(' ').slice(1).join(' ').toLowerCase() === sanitize(msg.guild.name.toLowerCase());
});

if (!folderName) {
  const uniqueId = generateLogId(); // e.g., 'abc123'

  // Sanitize just the guild name part
  const safeName = sanitize(msg.guild.name);

  folderName = `${uniqueId} ${safeName}`;
  fs.mkdirSync(path.join(logsDir, folderName), { recursive: true });
}




const guildLogDir = path.join(logsDir, folderName);


    if (!fs.existsSync(guildLogDir)) fs.mkdirSync(guildLogDir, { recursive: true });

    const logFile = path.join(guildLogDir, 'messages.txt');
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();

    fs.appendFileSync(logFile, `[${dateStr} ${timeStr}] ${msg.author.tag} (${msg.author.id}): ${msg.content || ''}\n`);

    // Check if author is watchlisted
    if (watchlist.includes(msg.author.id)) {
  const { matched } = checkFlags(msg.content);

  const wlData = {
    guildName: msg.guild.name,
    guildId: msg.guild.id,
    userId: msg.author.id,
    username: msg.author.tag,
    date: dateStr,
    time: timeStr,
    timestamp: now.toISOString(),
    content: msg.content || '',
    matched,
    link: `https://discord.com/channels/${msg.guild.id}/${msg.channel.id}/${msg.id}`
  };

  sendWatchlistWebhook(wlData);
}

    // Keyword risk check & flagged messages
    const ignoredServers = loadIgnoredServers();
if (!ignoredServers.includes(msg.guild.id)) {
  const { matched, risk } = checkFlags(msg.content);
  if (matched.length > 0) {
    const flaggedData = {
      guildName: msg.guild.name,
      guildId: msg.guild.id,
      userId: msg.author.id,
      username: msg.author.tag,
      date: dateStr,
      time: timeStr,
      timestamp: now.toISOString(),
      content: msg.content || '',
      matched,
      risk,
      link: `https://discord.com/channels/${msg.guild.id}/${msg.channel.id}/${msg.id}`
    };
    const count = logFlaggedMessage(flaggedData);
    flaggedData.flagCount = count;
    sendToWebhook(flaggedData);
  }
}
    // Commands usable in guild channels

    if (msg.content.startsWith('.request')) {
  const args = msg.content.split(' ').slice(1);
  const servers = getLoggedServers();

  if (args.length === 0) {
    if (servers.length === 0) {
      await msg.channel.send("No message logs found.");
      return;
    }
    await msg.channel.send(`\`\`\`\nServers with message logs:\n${servers.join('\n')}\n\`\`\``);
  } else {
    const serverArg = args.join(' ').toLowerCase();
    const matchedServer = servers.find(s => s.toLowerCase().startsWith(serverArg));

    if (!matchedServer) {
      await msg.channel.send(`No logs found for server: \`${args.join(' ')}\``);
      return;
    }

    await sendLogs(msg, matchedServer);
  }
  return;
}


    if (msg.content === '.topflags') {
  const files = fs.readdirSync(casesDir).filter(f => f.endsWith('.json'));
  const userFlags = [];

  for (const file of files) {
    const filePath = path.join(casesDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const count = Array.isArray(data) ? data.length : 0;
      const latest = data[count - 1];
      const username = latest?.username || 'Unknown';
      userFlags.push({ userId: file.replace('.json', ''), username, count });
    } catch {
      // skip bad files
    }
  }

  userFlags.sort((a, b) => b.count - a.count);
  const top = userFlags.slice(0, 25);

  if (top.length === 0) {
    await msg.channel.send("No flagged users found.");
  } else {
    const output = top.map((u, i) => `#${i + 1}: ${u.username} (<@${u.userId}>) - ${u.count} flags`).join('\n');
    await msg.channel.send(`\`\`\`\nTop 25 Users by Flag Count:\n${output}\n\`\`\``);
  }
  return;
}


if (msg.content === '.mutualwl') {
  await msg.channel.send('Checking watchlisted users for 2 or more mutual servers. This may take a few minutes...');
  const results = await watchlistWithTwoOrMoreMutuals(client, './watchlist.json');

  if (results.length === 0) {
    return msg.channel.send('No watchlisted users found with 2 or more mutual servers.');
  }

  const lines = results.map(r => `${r.usernameTag} (<@${r.userId}>) — Mutual Servers: ${r.mutualCount}`);
  const chunks = [];
  let currentChunk = 'Watchlisted users with 2+ mutual servers:\n';

  for (const line of lines) {
    if ((currentChunk + line + '\n').length > 1950) {
      chunks.push(currentChunk);
      currentChunk = '';
    }
    currentChunk += line + '\n';
  }
  if (currentChunk.length) chunks.push(currentChunk);

  for (const chunk of chunks) {
    await msg.channel.send(`\`\`\`\n${chunk}\`\`\``);
  }

  return;
}
if (msg.content.startsWith('.flagignore')) {
  const args = msg.content.split(' ').slice(1);
  const ignored = loadIgnoredServers();
  const devRoleId = '1394342876518813837';
  const member = msg.member;

  if (!member || !member.roles.cache.has(devRoleId)) {
    await msg.channel.send("You do not have permission to use this command.");
    return;
  }

  if (args.length === 0) {
    if (ignored.length === 0) return msg.channel.send("No ignored servers currently.");
    const list = ignored.map(id => {
      const guild = client.guilds.cache.get(id);
      return guild ? `${guild.name} (${id})` : `Unknown (${id})`;
    }).join('\n');
    return msg.channel.send(`\`\`\`\nIgnored Servers:\n${list}\n\`\`\``);
  }

  const action = args[0];
  const serverId = args[1] || msg.guild?.id;

  if (!serverId || !/^\d{17,19}$/.test(serverId)) {
    return msg.channel.send("Please provide a valid server ID.");
  }

  if (action === 'add') {
    if (ignored.includes(serverId)) {
      return msg.channel.send("Server is already in the ignore list.");
    }
    ignored.push(serverId);
    saveIgnoredServers(ignored);
    return msg.channel.send(`Added server ${serverId} to the flag ignore list.`);
  }

  if (action === 'remove') {
    const index = ignored.indexOf(serverId);
    if (index === -1) return msg.channel.send("Server is not in the ignore list.");
    ignored.splice(index, 1);
    saveIgnoredServers(ignored);
    return msg.channel.send(`Removed server ${serverId} from the flag ignore list.`);
  }

  return msg.channel.send("Usage: `.flagignore add <serverId>` or `.flagignore remove <serverId>`");
}

if (msg.content.startsWith('.bl')) {
  const args = msg.content.split(' ').slice(1);
  const blacklist = loadBlacklist();

  if (args.length === 0) {
    return msg.channel.send("Usage: `.bl add <phrase>`, `.bl remove <phrase>`, or `.bl list`");
  }

  const action = args[0].toLowerCase();

  if (action === 'list') {
    if (blacklist.length === 0) {
      return msg.channel.send("The blacklist is currently empty.");
    }
    const output = blacklist.map((phrase, i) => `${i + 1}. ${phrase}`).join('\n');
    return msg.channel.send(`\`\`\`\nBlacklisted Phrases:\n${output}\n\`\`\``);
  }

  const phrase = args.slice(1).join(' ').trim();
  if (!phrase) {
    return msg.channel.send("Please provide a phrase to add or remove.");
  }

  if (action === 'add') {
    if (blacklist.includes(phrase)) {
      return msg.channel.send("That phrase is already blacklisted.");
    }
    blacklist.push(phrase);
    saveBlacklist(blacklist);
    return msg.channel.send(`Added phrase to blacklist: \`${phrase}\``);
  }

  if (action === 'remove') {
    const index = blacklist.indexOf(phrase);
    if (index === -1) {
      return msg.channel.send("That phrase is not in the blacklist.");
    }
    blacklist.splice(index, 1);
    saveBlacklist(blacklist);
    return msg.channel.send(`Removed phrase from blacklist: \`${phrase}\``);
  }

  return msg.channel.send("Unknown action. Use `.bl add <phrase>`, `.bl remove <phrase>`, or `.bl list`.");
}


    if (msg.content.startsWith('.mutualcases')) {
      await msg.channel.send('Checking flagged users for 2 or more mutual servers. This takes roughly 1.5 seconds per flagged user (say .flagged to see all users)');
      const results = await flaggedWithTwoOrMoreMutuals(client, casesDir);

      if (results.length === 0) {
        await msg.channel.send('No flagged users found with 2 or more mutual servers.');
        return;
      }

      // Prepare output
      const lines = results.map(r => `${r.usernameTag} (<@${r.userId}>) — Mutual Servers: ${r.mutualCount}`);
      const chunks = [];
      let currentChunk = 'Flagged users with 2+ mutual servers:\n';

      for (const line of lines) {
        if ((currentChunk + line + '\n').length > 1950) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        currentChunk += line + '\n';
      }
      if (currentChunk.length) chunks.push(currentChunk);

      for (const chunk of chunks) {
        await msg.channel.send(`\`\`\`\n${chunk}\`\`\``);
      }
      return;
    }

    if (msg.content.startsWith('.mutual ')) {
      let target = msg.content.split(' ')[1];
if (!target) return msg.channel.send('Please provide a username or user ID.');

let userId = target;
if (!/^\d{17,19}$/.test(userId)) {
  const resolved = resolveUserIdFromUsername(target);
  if (!resolved) return msg.channel.send("No matching user found by that username.");
  userId = resolved;
}


      const mutualGuilds = await getMutualGuilds(client, userId);
      const mutualCount = mutualGuilds.length;

      if (mutualCount === 0) {
        return msg.channel.send(`No mutual servers with user ID ${userId}`);
      } else {
        const serverList = mutualGuilds.join('\n');
        return msg.channel.send(`Mutual servers with <@${userId}> (${mutualCount} total):\n\`\`\`\n${serverList}\n\`\`\``);
      }
    }

    if (msg.content.startsWith('.archive ')) {
  const args = msg.content.split(' ').slice(1);
  const target = args[0];
  let targetId = null;

  const archiveDir = path.join(__dirname, 'cases_archive');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);

  // If valid user ID
  if (/^\d{17,19}$/.test(target)) {
    targetId = target;
  } else {
    // Match by username
    const caseFiles = fs.readdirSync(casesDir).filter(f => f.endsWith('.json'));
    for (const file of caseFiles) {
      const filePath = path.join(casesDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const latest = Array.isArray(data) ? data[data.length - 1] : null;
        if (latest?.username?.toLowerCase() === target.toLowerCase()) {
          targetId = file.replace('.json', '');
          break;
        }
      } catch {}
    }
  }

  if (!targetId) {
    return msg.channel.send("No case file found for that user.");
  }

  const casePath = path.join(casesDir, `${targetId}.json`);
  const archivePath = path.join(archiveDir, `${targetId}.json`);

  if (!fs.existsSync(casePath)) {
    return msg.channel.send("Case file not found in active cases.");
  }

  try {
    fs.renameSync(casePath, archivePath);
    return msg.channel.send(`Archived case for <@${targetId}>.`);
  } catch (err) {
    console.error("Error archiving case file:", err);
    return msg.channel.send("Failed to archive the case file.");
  }
}

if (msg.content === '.stats') {
  const stats = {
    totalCases: 0,
    totalArchived: 0,
    totalWatchlisted: 0,
    totalBlacklisted: 0,
    totalKeywords: 0,
    totalFlags: 0,
    topUser: null,
    topFlagCount: 0,
  };

  // Load cases
  const caseFiles = fs.readdirSync(casesDir).filter(f => f.endsWith('.json'));
  stats.totalCases = caseFiles.length;

  for (const file of caseFiles) {
    const filePath = path.join(casesDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(data)) {
        const count = data.length;
        stats.totalFlags += count;
        if (count > stats.topFlagCount) {
          stats.topFlagCount = count;
          stats.topUser = data[0]?.username || file.replace('.json', '');
        }
      }
    } catch (err) {
      console.error(`Error parsing case file ${file}:`, err);
    }
  }

  // Load archive count
  if (fs.existsSync(archiveDir)) {
    const archived = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));
    stats.totalArchived = archived.length;
  }

  // Watchlist
  if (fs.existsSync(watchlistPath)) {
    try {
      const wl = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
      stats.totalWatchlisted = Object.keys(wl).length;
    } catch {}
  }

  // Blacklist
  if (fs.existsSync(blacklistPath)) {
    try {
      const bl = JSON.parse(fs.readFileSync(blacklistPath, 'utf8'));
      stats.totalBlacklisted = bl.length;
    } catch {}
  }

  // Keywords
  if (fs.existsSync(keywordsPath)) {
    try {
      const kw = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));
      stats.totalKeywords = kw.length;
    } catch {}
  }

  // Display results
  const report =
    `📊 **System Stats**\n\n` +
    `📁 Total Active Case Files: **${stats.totalCases}**\n` +
    `🗃️ Archived Case Files: **${stats.totalArchived}**\n` +
    `🚩 Total Flagged Messages: **${stats.totalFlags}**\n` +
    `👤 User with Most Flags: **${stats.topUser}** (${stats.topFlagCount})\n\n` +
    `🔍 Watchlist Entries: **${stats.totalWatchlisted}**\n` +
    `⛔ Blacklisted Phrases: **${stats.totalBlacklisted}**\n` +
    `📝 Keywords in Use: **${stats.totalKeywords}**`;

  await msg.channel.send(report);
}

if (msg.content === '.autoarchive') {
  const archiveDir = path.join(__dirname, 'cases_archive');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);

  const caseFiles = fs.readdirSync(casesDir).filter(f => f.endsWith('.json'));

  let movedCount = 0;

  for (const file of caseFiles) {
    const casePath = path.join(casesDir, file);
    const stats = fs.statSync(casePath);

    if (stats.size < 1024) { // Less than 1 KB
      const archivePath = path.join(archiveDir, file);

      try {
        fs.renameSync(casePath, archivePath);
        movedCount++;
      } catch (err) {
        console.error(`Failed to move ${file}:`, err);
      }
    }
  }

  return msg.channel.send(`Auto-archived ${movedCount} case file(s) smaller than 1 KB.`);
}

    if (msg.content === '.flagged') {
      const files = fs.readdirSync(casesDir).filter(f => f.endsWith('.json'));
      if (files.length === 0) {
        return msg.channel.send('No users have been flagged yet.');
      }

      const entries = files.map(f => {
        const filePath = path.join(casesDir, f);
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(raw);
          const latest = Array.isArray(data) ? data[data.length - 1] : null;
          const username = latest?.username || 'Unknown';
          return `${username} (${f.replace('.json', '')})`;
        } catch {
          return `Unknown (${f.replace('.json', '')})`;
        }
      });

      const chunks = [];
      let current = 'Flagged Users:\n';

      for (const line of entries) {
        if ((current + line + '\n').length > 1950) {
          chunks.push(current);
          current = '';
        }
        current += line + '\n';
      }
      if (current.length) chunks.push(current);

      for (const chunk of chunks) {
        await msg.channel.send(`\`\`\`\n${chunk}\`\`\``);
      }
      return;
    }

if (msg.content.startsWith('.case ')) {
  const args = msg.content.split(' ').slice(1);
  let target = args[0];
  let targetId = null;

  const casesDir = path.join(__dirname, 'cases');
  const archiveDir = path.join(__dirname, 'cases_archive');

  const getCaseFilePath = (userId) => {
    const mainPath = path.join(casesDir, `${userId}.json`);
    const archivePath = path.join(archiveDir, `${userId}.json`);
    if (fs.existsSync(mainPath)) return mainPath;
    if (fs.existsSync(archivePath)) return archivePath;
    return null;
  };

  // Check if target is user ID
  if (/^\d{17,19}$/.test(target)) {
    targetId = target;
  } else {
    // Attempt to match username to ID from both dirs
    const allFiles = fs.readdirSync(casesDir)
      .concat(fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir) : [])
      .filter(f => f.endsWith('.json'));

    for (const file of allFiles) {
      const filePath = getCaseFilePath(file.replace('.json', ''));
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const latest = Array.isArray(data) ? data[data.length - 1] : null;
        if (latest?.username?.toLowerCase() === target.toLowerCase()) {
          targetId = file.replace('.json', '');
          break;
        }
      } catch {}
    }
  }

  if (!targetId) {
    return msg.channel.send("No case found for that user.");
  }

  const caseFile = getCaseFilePath(targetId);
  if (!caseFile) return msg.channel.send("No case found for that user ID.");

  try {
    let entries = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
    if (!entries.length) return msg.channel.send("No flagged entries found for this user.");

    const flags = args.slice(1);

    // === Filters ===
    const filterHigh = flags.includes('--hi');
    const filterMed = flags.includes('--med');
    const filterLow = flags.includes('--low');

    const matchIndex = flags.indexOf('--match');
    const matchWord = matchIndex !== -1 && flags[matchIndex + 1] ? flags[matchIndex + 1].toLowerCase() : null;

    const limitIndex = flags.indexOf('--limit');
    const limit = limitIndex !== -1 && parseInt(flags[limitIndex + 1]) ? parseInt(flags[limitIndex + 1]) : null;

    // === Apply filters ===
    entries = entries.filter(entry => {
      if (filterHigh && entry.risk !== 'high') return false;
      if (filterMed && entry.risk !== 'medium') return false;
      if (filterLow && entry.risk !== 'low') return false;
      if (matchWord && !entry.content.toLowerCase().includes(matchWord)) return false;
      return true;
    });

    if (limit) {
      entries = entries.slice(-limit);
    }

    if (!entries.length) {
      return msg.channel.send("No matching entries found for this user with the specified filters.");
    }

    // Create PDF document
    const doc = new PDFDocument({ margin: 30, size: 'A4' });

    // Temp file path for PDF
    const tempPdfPath = path.join(__dirname, `case_${targetId}.pdf`);
    const stream = fs.createWriteStream(tempPdfPath);
    doc.pipe(stream);

    // Title
    doc.fontSize(18).text(`Case Report for ${entries[0].username}`, { underline: true });
    doc.moveDown();

    // Add entries
    entries.forEach((entry, i) => {
      const timeFormatted = new Date(entry.timestamp).toLocaleString();

      doc.fontSize(12).fillColor('black');
      doc.text(`Entry ${i + 1}`, { underline: true });
      doc.moveDown(0.25);
      doc.font('Helvetica-Bold').text(`Guild: `, { continued: true }).font('Helvetica').text(entry.guildName);
      doc.font('Helvetica-Bold').text(`Risk Level: `, { continued: true }).font('Helvetica').text(entry.risk.toUpperCase());
      doc.font('Helvetica-Bold').text(`Matched Keywords: `, { continued: true }).font('Helvetica').text(entry.matched.join(', '));
      doc.font('Helvetica-Bold').text(`Timestamp: `, { continued: true }).font('Helvetica').text(timeFormatted);
      doc.font('Helvetica-Bold').text(`Content:`).font('Helvetica').text(entry.content);
      doc.font('Helvetica-Bold').text(`Link: `).font('Helvetica').fillColor('blue').text(entry.link, { link: entry.link, underline: true });
      doc.moveDown();
    });

    doc.end();

    // Wait for PDF file to finish writing then send
    stream.on('finish', async () => {
      await msg.channel.send({
        files: [{ attachment: tempPdfPath, name: `case_${targetId}.pdf` }]
      });
      // Delete temp PDF after sending
      fs.unlinkSync(tempPdfPath);
    });

  } catch (err) {
    console.error('Error generating PDF case:', err);
    await msg.channel.send("Error reading or generating the case file.");
  }

  return;
}

    // WATCHLIST COMMAND: .wl <add|remove> <userId>
    if (msg.content.startsWith('.wl')) {
  const args = msg.content.split(' ').slice(1);
  const action = args[0]?.toLowerCase();

  // `.wl list`
  if (action === 'list') {
  if (watchlist.length === 0) {
    return msg.channel.send('The watchlist is currently empty.');
  }

  await msg.channel.send('Fetching usernames for watchlisted users...');

  const lines = [];

  for (let i = 0; i < watchlist.length; i++) {
    const userId = watchlist[i];
    try {
      const user = await client.users.fetch(userId);
      lines.push(`${i + 1}. ${user.tag} (<@${userId}>)`);
    } catch {
      lines.push(`${i + 1}. User: (<@${userId}>)`);
    }
  }

  const chunks = [];
  let current = 'Watchlisted Users:\n';

  for (const line of lines) {
    if ((current + line + '\n').length > 1950) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current.length) chunks.push(current);

  for (const chunk of chunks) {
    await msg.channel.send(`\`\`\`\n${chunk}\`\`\``);
  }
  return;
}

  // `.wl add <userId>` or `.wl remove <userId>`
  if (args.length < 2) {
    await msg.channel.send("Usage: `.wl add <userId>`, `.wl remove <userId>`, or `.wl list`");
    return;
  }

  let userId = args[1];
if (!/^\d{17,19}$/.test(userId)) {
  const resolved = resolveUserIdFromUsername(userId);
  if (!resolved) {
    await msg.channel.send("No matching user found by that username.");
    return;
  }
  userId = resolved;
}

  if (action === 'add') {
    if (watchlist.includes(userId)) {
      await msg.channel.send(`User <@${userId}> is already on the watchlist.`);
      return;
    }
    watchlist.push(userId);
    saveWatchlist(watchlist);
    await msg.channel.send(`Added user <@${userId}> to the watchlist.`);
  } else if (action === 'remove') {
    if (!watchlist.includes(userId)) {
      await msg.channel.send(`User <@${userId}> is not on the watchlist.`);
      return;
    }
    const index = watchlist.indexOf(userId);
    watchlist.splice(index, 1);
    saveWatchlist(watchlist);
    await msg.channel.send(`Removed user <@${userId}> from the watchlist.`);
  } else {
    await msg.channel.send("Invalid action. Use `add`, `remove`, or `list`.");
  }
  return;
}

    if (msg.content.startsWith('.delcase ')) {
  const devRoleId = '1394342876518813837';
  if (!msg.member.roles.cache.has(devRoleId)) {
    await msg.channel.send("You do not have permission to use this command.");
    return;
  }

  const args = msg.content.split(' ').slice(1);
  if (args.length !== 1) {
    await msg.channel.send("Usage: `.delcase <userId>`");
    return;
  }

  let userId = args[0];
if (!/^\d{17,19}$/.test(userId)) {
  const resolved = resolveUserIdFromUsername(userId);
  if (!resolved) return msg.channel.send("No matching user found by that username.");
  userId = resolved;
}
const caseFile = path.join(casesDir, `${userId}.json`);


  if (!fs.existsSync(caseFile)) {
    await msg.channel.send(`No case file found for user ID ${userId}.`);
    return;
  }

  try {
    fs.unlinkSync(caseFile);
    await msg.channel.send(`Case file for user ID ${userId} has been deleted.`);
  } catch (error) {
    console.error('Error deleting case file:', error);
    await msg.channel.send('Failed to delete the case file.');
  }
  return;
}

    if (msg.content === '.info') {
  return msg.channel.send(`\`\`\`ini
[ Logging & Case Management ]
.request [server]         - List or download message logs
.case <userId> [filters]  - Show flagged messages for a user
  --hi                    - Only show high severity messages
  --med                   - Only show medium severity messages
  --low                   - Only show low severity messages
  --match <keyword>       - Only messages containing this keyword
  --limit <N>             - Show only the last N entries

.flagged                  - List all users with case files
.topflags                 - List top 25 flagged users

[ Mutual Server Analysis ]
.mutualcases              - Flagged users in 2+ mutual servers
.mutualwl                 - Watchlisted users in 2+ mutual servers
.mutual <userId>          - Show mutual servers with a user

[ Watchlist Management ]
.wl add <userId>          - Add a user to the watchlist
.wl remove <userId>       - Remove a user from the watchlist
.wl list                  - List all watchlisted users

[ Keyword Suggestion ]
.key [keyword]            - Suggest a keyword (send in DMs of this account)

[ Blacklist Management ]
.bl add <phrase>          - Prevent exact matches from being flagged
.bl remove <phrase>       - Remove phrase from blacklist
.bl list                  - Show all blacklisted phrases

[ Help ]
.info                     - Show this help message

[ Admin Only ]
.flagignore add <serverId>    - Prevents server from being flagged
.flagignore remove <serverId> - Removes from ignore list
.delcase <userId>             - Remove a user's flags (for closed cases)
\`\`\``);
}
  // === GLOBAL COMMAND (DM or Guild) ===
      }
  }

  // DM-based keyword suggestion command
  if (!msg.guild && msg.content.startsWith('.key ')) {
    const keyword = msg.content.slice(5).trim().toLowerCase();
    if (!keyword) {
      await msg.channel.send("Please provide a keyword after `.key`.");
      return;
    }

    let suggestions = [];
    if (fs.existsSync(suggestedKeywordsFile)) {
      try {
        suggestions = JSON.parse(fs.readFileSync(suggestedKeywordsFile, 'utf8'));
        if (!Array.isArray(suggestions)) suggestions = [];
      } catch {
        suggestions = [];
      }
    }

    if (suggestions.includes(keyword)) {
      await msg.channel.send(`Keyword \`${keyword}\` has already been suggested.`);
      return;
    }

    suggestions.push(keyword);
    try {
      fs.writeFileSync(suggestedKeywordsFile, JSON.stringify(suggestions, null, 2));
    } catch (err) {
      console.error('Error writing suggested keywords:', err);
      await msg.channel.send('Failed to save keyword suggestion.');
      return;
    }

    await msg.channel.send(`Suggested keyword \`${keyword}\` has been added.`);

    try {
      const notifyUser = await client.users.fetch(keywordReviewUserId);
      if (notifyUser) {
        notifyUser.send(`📬 New keyword suggested: \`${keyword}\`\nBy: ${msg.author.tag} (${msg.author.id})`);
      }
    } catch (err) {
      console.error('Error notifying keyword reviewer:', err);
    }
  }
});

client.login(process.env.TOKEN);
