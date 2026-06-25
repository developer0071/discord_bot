const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runDispatcher() {
    // Random sleep between 60 and 300 seconds
    const sleepDuration = Math.floor(Math.random() * (300 - 60 + 1) + 60);
    console.log(`[INFO] Sleeping for ${sleepDuration} seconds before sending...`);
    await new Promise(resolve => setTimeout(resolve, sleepDuration * 1000));

    const authToken = (process.env.USER_TOKEN || "").trim();
    const channelId = (process.env.ANNOUNCEMENT_CHANNEL_ID || "").trim();
    const proxyUrl = (process.env.HTTP_PROXY || "").trim();

    if (!authToken || !channelId) {
        console.error("[CRITICAL] Missing USER_TOKEN or ANNOUNCEMENT_CHANNEL_ID.");
        process.exit(1);
    }

    let broadcastContent = "";
    try {
        broadcastContent = fs.readFileSync(path.join(__dirname, 'message.txt'), 'utf-8').trim();
        if (!broadcastContent) {
            console.error("[CRITICAL] message.txt is empty.");
            process.exit(1);
        }
    } catch (err) {
        console.error("[CRITICAL] message.txt not found.");
        process.exit(1);
    }

    const apiEndpoint = `https://discord.com/api/v10/channels/${channelId}/messages`;

    const requestHeaders = {
        "Authorization": authToken,
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://discord.com",
        "Referer": `https://discord.com/channels/@me/${channelId}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    const requestPayload = {
        content: broadcastContent,
        tts: false
    };

    const axiosConfig = {
        headers: requestHeaders,
        timeout: 30000
    };

    if (proxyUrl) {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
    }

    try {
        const response = await axios.post(apiEndpoint, requestPayload, axiosConfig);
        if (response.status === 200 || response.status === 201) {
            console.log("[INFO] Message delivered successfully.");
            process.exit(0);
        }
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            if (status === 401) {
                console.error("[CRITICAL] 401 Unauthorized — token is invalid or expired.");
            } else if (status === 403) {
                console.error("[CRITICAL] 403 Forbidden — no permission to send in this channel.");
            } else if (status === 429) {
                const retryAfter = error.response.data?.retry_after || 5;
                console.error(`[WARN] Rate limited. Retry after ${retryAfter}s.`);
            } else {
                console.error(`[ERROR] Unexpected status: ${status}`);
            }
            console.error(`[DEBUG] Response: ${JSON.stringify(error.response.data)}`);
        } else {
            console.error(`[CRITICAL] Network exception: ${error.message}`);
        }
        process.exit(1);
    }
}

runDispatcher();
