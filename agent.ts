import { convertToModelMessages, streamText } from "ai";
import * as blink from "blink";
import * as slack from "@blink-sdk/slack";
import { App } from "@slack/bolt";
import { tool } from "ai";
import { z } from "zod";

const receiver = new slack.Receiver();
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  receiver,
});

// Handle messages in channels (only when @mentioned)
app.event("app_mention", async ({ event }) => {
  const chat = await agent.chat.upsert([
    "slack",
    event.channel,
    event.thread_ts ?? event.ts,
  ]);
  const { message } = await slack.createMessageFromEvent({
    client: app.client,
    event,
  });
  await agent.chat.sendMessages(chat.id, [message]);
  await app.client.assistant.threads.setStatus({
    channel_id: event.channel,
    status: "is typing...",
    thread_ts: event.thread_ts ?? event.ts,
  });
});

// Handle direct messages (always respond)
app.event("message", async ({ event }) => {
  // Ignore bot messages and message changes
  if (event.subtype || event.bot_id) {
    return;
  }
  // Only handle DMs (channel type is 'im')
  const channelInfo = await app.client.conversations.info({
    channel: event.channel,
  });
  if (!channelInfo.channel?.is_im) {
    return;
  }
  const chat = await agent.chat.upsert(["slack", event.channel]);
  const { message } = await slack.createMessageFromEvent({
    client: app.client,
    event,
  });
  await agent.chat.sendMessages(chat.id, [message]);
  await app.client.assistant.threads.setStatus({
    channel_id: event.channel,
    status: "is typing...",
    thread_ts: event.thread_ts ?? event.ts,
  });
});

const agent = new blink.Agent();

agent.on("request", async (request) => {
  const url = new URL(request.url);
  
  console.log(`Received ${request.method} request to ${url.pathname}`);
  
  // Handle daily news summary webhook (must be before Slack receiver)
  if (url.pathname === "/daily-news" && request.method === "POST") {
    console.log("Processing /daily-news webhook...");
    const CHANNEL_ID = "C09FCMVAUB0";
    
    try {
      // Create a new chat for each summary request (uses timestamp for uniqueness)
      const chat = await agent.chat.upsert(["daily-news", Date.now()]);
      
      // Send message to AI for news research and summary
      await agent.chat.sendMessages(
        chat.id,
        [
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: `Generate a daily news summary and post it to Slack channel ${CHANNEL_ID}. Use your tools to research the latest news and create an engaging summary. After analyzing, post the formatted summary to the Slack channel using the postToSlackChannel tool.`,
              },
            ],
          },
        ],
        { behavior: "enqueue" }
      );
      
      return new Response("Summary request queued successfully", { status: 200 });
    } catch (error) {
      console.error("Error posting news summary:", error);
      return new Response(`Error posting summary: ${error}`, { status: 500 });
    }
  }
  
  // All other requests go to Slack receiver
  return receiver.handle(app, request);
});

agent.on("chat", async ({ messages }) => {
  const tools = {
    ...slack.createTools({ client: app.client }),
    postToSlackChannel: tool({
      description: "Post a message to a Slack channel",
      inputSchema: z.object({
        channel: z.string().describe("The channel ID to post to"),
        text: z.string().describe("The message text to post"),
      }),
      execute: async ({ channel, text }) => {
        await app.client.chat.postMessage({
          channel,
          text,
        });
        return "Message posted successfully";
      },
    }),
  };
  
  const lastMessage = messages[messages.length - 1];
  const threadInfo = lastMessage?.metadata as
    | { channel?: string; thread_ts?: string }
    | undefined;

  // Add instruction to clear status after completion
  if (threadInfo?.channel && threadInfo?.thread_ts) {
    const clonedMessages = structuredClone(messages);
    const lastClonedMessage = clonedMessages[clonedMessages.length - 1];
    if (lastClonedMessage) {
      lastClonedMessage.parts.push({
        type: "text",
        text: `*INTERNAL INSTRUCTION*: Clear the status of this thread after you finish: channel=${threadInfo.channel} thread_ts=${threadInfo.thread_ts}`,
      });
    }
    messages = clonedMessages;
  }

  return streamText({
    model: "anthropic/claude-sonnet-4.5",
    system: `You are a helpful Slack bot assistant.

## Your Capabilities

You have access to Slack tools for reading messages, sending messages, reacting to messages, and posting to channels.

## Special Feature: Daily News Summaries

This agent is configured to automatically post daily news summaries. Here's how it works:

1. **Webhook Trigger**: The agent has a /daily-news webhook endpoint that gets triggered daily by a GitHub Action
2. **Your Job**: When you receive news summary requests, you should:
   - Research the latest news using available tools
   - Create an engaging, well-formatted summary
   - Use emojis and Slack formatting to make it readable
   - Use the postToSlackChannel tool to post the summary to the specified channel

## How to Interact

Users can @mention you in channels or send you direct messages. Always be helpful, concise, and use Slack's rich formatting when appropriate.`,
    messages: convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    }),
    tools,
  });
});

agent.serve();