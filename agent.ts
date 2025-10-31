import { convertToModelMessages, streamText } from "ai";
import * as blink from "blink";
import * as slack from "@blink-sdk/slack";
import { App } from "@slack/bolt";
import { tool } from "ai";
import { z } from "zod";
import Exa from "exa-js";

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
                text: `It's time to generate today's daily news summary. Research trending articles from credible sources and create the summary according to the FQ pillars and format specified in your system prompt. Post the formatted summary to Slack channel ${CHANNEL_ID} using the postToSlackChannel tool.`,
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
          unfurl_links: false,
          unfurl_media: false,
        });
        return "Message posted successfully";
      },
    }),
    getCurrentDate: tool({
      description: "Get the current date and time. Use this to know what day it is when generating daily summaries.",
      inputSchema: z.object({}),
      execute: async () => {
        const now = new Date();
        return {
          date: now.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          }),
          iso: now.toISOString(),
          timestamp: now.getTime(),
        };
      },
    }),
    webSearch: tool({
      description: "Search the web for recent news articles and information. Use this to find trending articles from credible media outlets like The Atlantic, New York Times, Wall Street Journal, etc. Returns actual article titles, URLs, authors, and publication dates.",
      inputSchema: z.object({
        query: z.string().describe("The search query for news articles"),
        numResults: z.number().default(10).describe("Number of results to return (default: 10)"),
      }),
      execute: async ({ query, numResults }) => {
        const exaApiKey = process.env.EXA_API_KEY;
        if (!exaApiKey) {
          return "Error: EXA_API_KEY environment variable not set. Please add it to .env.local or .env.production";
        }

        try {
          const exa = new Exa(exaApiKey);
          const result = await exa.searchAndContents(query, {
            type: "neural",
            useAutoprompt: true,
            numResults,
            text: { maxCharacters: 500 },
            livecrawl: "always",
          });

          const articles = result.results.map((item: any) => ({
            title: item.title,
            url: item.url,
            author: item.author || "Unknown",
            publishedDate: item.publishedDate || "Date not available",
            summary: item.text || "No summary available",
            score: item.score,
          }));

          return JSON.stringify(articles, null, 2);
        } catch (error) {
          return `Error searching: ${error instanceof Error ? error.message : String(error)}`;
        }
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
    system: `You are a news research assistant for The Female Quotient (FQ), focused on scanning credible media outlets for trending articles.

## Daily News Summary Task

Each morning, scan credible media outlets, magazines, and blogs for trending or widely shared articles. Focus on trustworthy reporting over social virality.

## Focus Areas (FQ Pillars)
- Friendship
- Money
- Women taking action
- Taboo topics that should not be
- Male advocates
- Women's health
- Parenthood
- Caregiving
- Workplace laws
- Country laws affecting employees

## Output Format

For each article include:
- Title, Publication, Author (if available), Link, and Publication Date
- A 2-3 sentence summary of the main takeaway and relevance
- Pillar Tags: List the relevant pillars (e.g., Money, Parenthood)
- Trend Signal: Note if it has been widely shared, cited, or tied to a larger cultural/policy moment
- Cross-Platform Context: Mention if it is driving engagement on LinkedIn, Instagram, or TikTok and how
- Strategic Insight: Add 2-3 bullets on why it matters for The Female Quotient community and how it could inspire discussion or new ideas

## Example Output Format

Top articles for today, January 15, 2025:

1. **"Why Women Are Reimagining Friendship in Midlife"**
*The Atlantic – Amanda Mull*
https://www.theatlantic.com/example
Explores how women are redefining friendship post-pandemic, prioritizing honesty and mutual support.

**Pillar(s):** Friendship
**Trend Signal:** Widely shared on LinkedIn; cited in multiple newsletters
**Cross-Platform:** TikTok videos on intentional friendship
**Strategic Insight:**
- Reflects evolving definitions of community and care
- Could inspire FQ dialogue around emotional connection and belonging

## CRITICAL: Output Requirements

- Do NOT add any preamble at the top of your response
- The response should start IMMEDIATELY with: "Top articles for today, [date]:"
- Then list 5-10 articles in the format above
- Use getCurrentDate tool FIRST to know what day it is
- Use the webSearch tool to find trending articles from credible sources
- **NEVER fabricate or hallucinate URLs, article titles, authors, or content**
- Only include articles that you have actual information about from search results
- If you cannot find real articles, say so rather than making them up
- After creating the summary, use postToSlackChannel to post it

## How to Interact

When users mention you in channels or send direct messages, be helpful and concise. For daily news summary requests triggered by the webhook, follow the exact format above.`,
    messages: convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    }),
    tools,
  });
});

agent.serve();
