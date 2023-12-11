require('dotenv').config();
const fs = require('fs');
const {
    Client,
    GatewayIntentBits,
    ActivityType
} = require('discord.js');
const {
    google
} = require('googleapis');
const readline = require('readline');
const express = require('express');
const app = express();
const schedule = require('node-schedule');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

const credentials = require('./credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH1 = 'token1.json';
const TOKEN_PATH2 = 'token2.json';

const PORT = 3000;

const {
    client_secret,
    client_id,
    redirect_uris
} = credentials.web;
const oAuth2Client1 = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
const oAuth2Client2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris[1]);

let dailyProblems = {}; // Object to store email data keyed by problem number

// OAuth2 callback endpoint for the first account
app.get('/oauth2callback1', async (req, res) => {
    await handleOAuth2Callback(req, res, TOKEN_PATH1, oAuth2Client1);
});

// OAuth2 callback endpoint for the second account
app.get('/oauth2callback2', async (req, res) => {
    await handleOAuth2Callback(req, res, TOKEN_PATH2, oAuth2Client2);
});

// Handles OAuth2 callback logic
async function handleOAuth2Callback(req, res, tokenPath, oAuth2Client) {
    const code = req.query.code;
    if (code) {
        try {
            const {
                tokens
            } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            fs.writeFile(tokenPath, JSON.stringify(tokens), (err) => {
                if (err) return console.error('Error writing token to file', err);
                console.log('Token stored to', tokenPath);
            });
            res.send('Authentication successful! You can close this tab.');
        } catch (error) {
            console.error('Error retrieving access token', error);
            res.send('Error retrieving access token. Check console for details.');
        }
    } else {
        res.send('No code found in the request.');
    }
}

app.listen(PORT, () => {
    console.log(`Express server is running on port ${PORT}`);
});

function authorize(credentials, discordClient, callback, tokenPath, oAuth2Client) {
    fs.readFile(tokenPath, (err, token) => {
        if (err) {
            getNewToken(oAuth2Client, discordClient, callback, tokenPath);
        } else {
            const tokens = JSON.parse(token);
            if (tokens.refresh_token) {
                oAuth2Client.setCredentials(tokens);
                if (tokens.expiry_date <= Date.now()) {
                    refreshAccessToken(oAuth2Client, tokenPath); // Refresh token if expired
                }
            } else {
                getNewToken(oAuth2Client, discordClient, callback, tokenPath);
            }
            callback(oAuth2Client, discordClient);
        }
    });
}

function refreshAccessToken(oAuth2Client, tokenPath) {
    oAuth2Client.refreshAccessToken((err, tokens) => {
        if (err) {
            console.error('Error refreshing access token', err);
            return;
        }
        oAuth2Client.setCredentials(tokens);
        tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
        fs.writeFile(tokenPath, JSON.stringify(tokens), (err) => {
            if (err) console.error('Error writing refreshed token', err);
            else console.log('Refreshed token stored to', tokenPath);
        });
    });
}

function getNewToken(oAuth2Client, discordClient, callback, tokenPath) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            fs.writeFile(tokenPath, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', tokenPath);
                callback(oAuth2Client, discordClient);
            });
        });
    });
}

function checkEmails(auth, discordClient, storeOnly = false) {
    const gmail = google.gmail({
        version: 'v1',
        auth
    });
    gmail.users.messages.list({
        userId: 'me',
        q: 'subject:Daily Coding Problem',
    }, (err, res) => {
        if (err) return console.log('The API returned an error: ' + err);
        const messages = res.data.messages;
        if (messages && messages.length) {
            messages.forEach((message) => {
                gmail.users.messages.get({
                    userId: 'me',
                    id: message.id,
                    format: 'full',
                }, (err, res) => {
                    if (err) return console.log('Error fetching email:', err);

                    const headers = res.data.payload.headers;
                    const subjectHeader = headers.find(header => header.name === 'Subject');
                    const subject = subjectHeader ? subjectHeader.value : "No Subject";

                    const dcpRegex = /Daily Coding Problem: Problem #\d+ \[.+\]/;
                    if (dcpRegex.test(subject)) {
                        let problemNumberMatch = subject.match(/\d+/);
                        if (problemNumberMatch) {
                            let problemNumber = problemNumberMatch[0];

                            let body = "No Content";
                            if (res.data.payload.parts) {
                                const part = res.data.payload.parts.find(part => part.mimeType === 'text/plain');
                                if (part) {
                                    body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                                }
                            } else if (res.data.payload.body.data) {
                                body = Buffer.from(res.data.payload.body.data, 'base64').toString('utf-8');
                            }

                            const lineToRemove = "Good morning! Here's your coding interview problem for today.";
                            body = body.replace(lineToRemove, '').trim();

                            const truncateAt = body.indexOf('--------------------------------------------------------------------------------');
                            if (truncateAt !== -1) {
                                body = body.substring(0, truncateAt);
                            }

                            if (storeOnly) {
                                dailyProblems[problemNumber] = {
                                    subject,
                                    body,
                                    id: message.id
                                };
                            } else {
                                const channel = discordClient.channels.cache.get('YOUR_CHANNEL_ID');
                                if (channel) {
                                    channel.send(`${subject}\n\`\`\`\n${body}\n\`\`\``);
                                } else {
                                    console.log('Channel not found');
                                }
                            }
                        }
                    }
                });
            });
        } else {
            console.log('No matching emails found.');
        }
    });
}

client.once('ready', async () => {
    console.log('Bot is online and ready!');
    authorize(credentials, client, (auth) => checkEmails(auth, client, true), TOKEN_PATH1, oAuth2Client1);
    authorize(credentials, client, (auth) => checkEmails(auth, client, true), TOKEN_PATH2, oAuth2Client2);

    client.user.setPresence({ 
        activities: [{ 
            name: 'Type ?help for usage!', 
            type: ActivityType.Playing
        }], 
        status: 'online' 
    });

    schedule.scheduleJob('35 8 * * *', function() {
        console.log('Running scheduled cache update at 8:35 AM');
        authorize(credentials, client, (auth) => checkEmails(auth, client, true), TOKEN_PATH1, oAuth2Client1);
        authorize(credentials, client, (auth) => checkEmails(auth, client, true), TOKEN_PATH2, oAuth2Client2);
    });
});

client.on('messageCreate', message => {
    if (message.content.startsWith('?')) {
        const args = message.content.split('?');
        if (args.length === 1) {
            message.channel.send('Please specify a command: list, update, help, or a problem number');
        } else if (args[1] === 'list') {
            const MAX_CHARS = 2000;
            let responseLines = Object.keys(dailyProblems).map(key => `${key}: ${dailyProblems[key].subject}`);
            let messageChunk = '';

            for (let line of responseLines) {
                if (messageChunk.length + line.length > MAX_CHARS) {
                    message.channel.send(messageChunk);
                    messageChunk = line + '\n';
                } else {
                    messageChunk += line + '\n';
                }
            }

            if (messageChunk.length > 0) {
                message.channel.send(messageChunk);
            }
        } else if (args[1] === 'update') {
            authorize(credentials, client, (auth) => checkEmails(auth, client, true), TOKEN_PATH1, oAuth2Client1);
            authorize(credentials, client, (auth) => checkEmails(auth, client, true), TOKEN_PATH2, oAuth2Client2);

            message.channel.send('Updating cache with the latest emails. This may take a few moments.');
        } else if (args[1] === 'help') {
            message.channel.send(
                'Daily Coding Problem Bot Commands:\n' +
                '`?list`: Lists all available coding problems.\n' +
                '`?<number>`: Displays the specific coding problem by number.\n' +
                '`?update`: Manually updates the cache with the latest problems.\n' +
                'Daily Update: The bot automatically updates the cache every morning at 8:35 AM.'
            );
        } else {
            const problemNumber = args[1];
            if (dailyProblems[problemNumber]) {
                const problem = dailyProblems[problemNumber];
                message.channel.send(`${problem.subject}\n\n${problem.body}\n`);
            } else {
                message.channel.send(`Problem number ${problemNumber} is invalid or not available, get available problems with \`!dcp list\`.`);
                const MAX_CHARS = 2000;
                let responseLines = Object.keys(dailyProblems).map(key => `${key}: ${dailyProblems[key].subject}`);
                let messageChunk = '';

                for (let line of responseLines) {
                    if (messageChunk.length + line.length > MAX_CHARS) {
                        message.channel.send(messageChunk);
                        messageChunk = line + '\n';
                    } else {
                        messageChunk += line + '\n';
                    }
                }

                if (messageChunk.length > 0) {
                    message.channel.send(messageChunk);
                }
            }
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
