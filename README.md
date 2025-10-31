# Daily News Summary Agent

A Blink agent that generates daily news summaries for The Female Quotient (FQ) by researching trending articles from credible media outlets and posting them to Slack.

<img width="1231" height="1333" alt="image" src="https://github.com/user-attachments/assets/c3c7458b-be6f-4d8a-9c7d-56a6ef664d43" />


## Capabilities

### Automated Daily Summaries
- Triggered via webhook POST to `/daily-news`
- Researches trending articles from credible sources (The Atlantic, NYT, WSJ, etc.)
- Filters articles based on FQ's focus pillars
- Posts formatted summaries directly to Slack
- **Never shares the same article twice** (permanent deduplication)

### Slack Integration
- Responds to @mentions in channels
- Responds to direct messages
- Sets "is typing..." status for better UX
- Posts with link unfurling disabled for cleaner formatting

## FQ Focus Pillars

The agent curates articles around these themes:
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

## Tools

### `webSearch`
Searches the web for recent news articles using Exa API
- **Parameters:** 
  - `query` (string) - The search query for news articles
  - `numResults` (number, default: 15) - Number of results to return
  - `startPublishedDate` (string, optional) - Start date in YYYY-MM-DD format (defaults to 7 days ago)
- **Returns:** Article metadata including title, URL, author, publication date, and summary
- **Features:**
  - Automatically filters to articles from the last 7 days
  - Restricts results to 20 credible news sources (NYT, The Atlantic, WSJ, Guardian, Forbes, etc.)
  - Supports multiple searches for comprehensive coverage across FQ pillars

### `getCurrentDate`
Gets the current date and time
- **Parameters:** None
- **Returns:** Formatted date, ISO timestamp, and Unix timestamp

### `checkPreviouslySharedArticles`
Checks which URLs have been previously shared to avoid duplicates
- **Parameters:** `urls` (array of strings)
- **Returns:** Lists of previously shared and new articles

### `recordSharedArticles`
Records article URLs as shared (permanent storage)
- **Parameters:** `urls` (array of strings)
- **Returns:** Confirmation with timestamp

### `postToSlackChannel`
Posts a message to a Slack channel
- **Parameters:** `channel` (channel ID), `text` (message content)
- **Behavior:** Disables link unfurling for cleaner messages

### Slack Tools
Includes all standard Slack tools from `@blink-sdk/slack`:
- `reportStatus` - Set/clear thread status
- `sendMessage` - Send messages with advanced formatting
- Additional Slack API capabilities

## Setup

### Environment Variables

Create a `.env.local` file with:

```env
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-secret
EXA_API_KEY=your-exa-key
ANTHROPIC_API_KEY=your-key
```

### Webhook Setup

To trigger daily summaries, send a POST request to:
```
https://your-agent-url.blink.host/daily-news
```

You can automate this with:
- GitHub Actions scheduled workflows
- Cron jobs
- Cloud scheduler services (AWS EventBridge, Google Cloud Scheduler, etc.)

### Slack App Configuration

Required bot scopes:
- `app_mentions:read`
- `chat:write`
- `channels:history`
- `groups:history`
- `im:history`
- `im:write`
- `assistant:write` (for status updates)

Required events:
- `app_mention`
- `message`
- `assistant_thread_started`

## Output Format

Each daily summary includes:

```
Top articles for today, [date]:

1. **"Article Title"**
*Publication – Author*
https://article-url.com
Brief summary of the article.

**Pillar(s):** [Relevant pillars]
**Trend Signal:** [Social sharing/cultural moment notes]
**Cross-Platform:** [LinkedIn/Instagram/TikTok engagement]
**Strategic Insight:**
- Why it matters for FQ community
- How it could inspire discussion
```

## Content Discovery Strategy

### Credible News Sources
The agent searches only from these verified outlets:
- **Major newspapers:** NYT, WSJ, Washington Post, The Guardian
- **News agencies:** Reuters, AP, NPR, BBC
- **Business outlets:** Forbes, Fortune, Bloomberg, Business Insider, HBR
- **Quality analysis:** The Atlantic, New Yorker, Vox, Axios, Politico, Time, The Economist

### Search Strategy
The agent runs multiple targeted searches to maximize relevant content:
- Searches each FQ pillar topic individually (e.g., "women workplace equality", "women's health policy")
- Searches general trending topics (e.g., "women leadership news")
- Defaults to articles published in the last 7 days
- Returns 15 results per search for a larger pool after deduplication

## Article Deduplication

- Articles are tracked by URL in persistent storage
- Once shared, an article will **never** be shared again
- Storage persists across agent restarts and deployments
- No expiration (articles remain blocked permanently)

## Usage

### Run the agent
```bash
blink dev
```

### Trigger a daily summary
```bash
curl -X POST https://your-agent-url.blink.host/daily-news
```

### Interact in Slack
- @mention the bot in any channel
- Send a direct message
- The bot will respond helpfully to questions about articles or FQ topics
