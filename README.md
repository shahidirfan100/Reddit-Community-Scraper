# Reddit Community Scraper

Comprehensive Reddit scraper that extracts posts, comments, communities, and users from Reddit using the JSON API. Perfect for data analysis, research, and monitoring Reddit content.

## Features

- 📝 **Post Scraping** - Extract posts from subreddits, user profiles, or specific posts
- 💬 **Comment Scraping** - Collect comments from posts with configurable depth limits
- 🔍 **Advanced Search** - Search for posts, communities, users, and comments
- 🎯 **Flexible Filtering** - Filter by date, NSFW content, and custom time ranges
- 📊 **Pagination Control** - Specify start/end pages for precise data collection
- ⚡ **High Performance** - Concurrent scraping with proxy support
- 🎨 **Rich Data Output** - Structured JSON with all relevant metadata

## Input Parameters

### Basic Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startUrls` | Array | `[{ "url": "https://www.reddit.com/r/GrowthHacking/" }]` | List of Reddit URLs to scrape (subreddits, posts, or user profiles) |
| `maxPostCount` | Integer | `4` | Maximum number of posts to scrape (0-10000) |
| `maxCommentsPerPost` | Integer | `2` | Maximum number of comments to scrape per post (0-1000, 0 = no comments) |
| `skipComments` | Boolean | `false` | If true, skip scraping comments entirely |

### Pagination

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startPage` | Integer | `1` | Page number to start scraping from |
| `endPage` | Integer | `null` | Page number to stop at (leave empty for unlimited) |

### Search & Filtering

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `searchQuery` | String | `""` | Search term to find posts, communities, or users |
| `searchPosts` | Boolean | `false` | Search for posts matching the query |
| `searchCommunities` | Boolean | `false` | Search for communities (subreddits) matching the query |
| `searchComments` | Boolean | `false` | Search for comments matching the query |
| `sort` | String | `"new"` | Sort order: `hot`, `new`, `top`, `rising`, `relevance`, `best`, `comments` |
| `time` | String | `"all"` | Time filter: `hour`, `day`, `week`, `month`, `year`, `all` |
| `maxPostAgeDays` | Integer | `null` | Only scrape posts from the last N days |
| `includeNSFW` | Boolean | `false` | Include NSFW (Not Safe For Work) posts |

### Advanced Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ignoreStartUrls` | Boolean | `false` | If true, startUrls will be ignored (useful when only using search) |
| `maxConcurrency` | Integer | `10` | Maximum concurrent requests |
| `maxRequestRetries` | Integer | `3` | Maximum number of retries for failed requests |
| `scrollTimeout` | Integer | `400` | Timeout for scrolling in milliseconds |
| `debugMode` | Boolean | `false` | Enable detailed logging for debugging |
| `proxy` | Object | `{ "useApifyProxy": true }` | Proxy configuration for the scraper |

## Output Format

The scraper outputs structured JSON data with three types of items:

### Post Data
```json
{
  "dataType": "post",
  "id": "t3_abc123",
  "parsedId": "abc123",
  "url": "https://www.reddit.com/r/...",
  "username": "reddit_user",
  "userId": "t2_xyz789",
  "title": "Post Title",
  "communityName": "r/subreddit",
  "parsedCommunityName": "subreddit",
  "body": "Post content...",
  "html": "<div>Post HTML...</div>",
  "link": "https://external-link.com",
  "numberOfComments": 42,
  "flair": "Discussion",
  "upVotes": 1234,
  "upVoteRatio": 0.95,
  "isVideo": false,
  "isAd": false,
  "over18": false,
  "thumbnailUrl": "https://...",
  "imageUrls": ["https://..."],
  "createdAt": "2025-01-15T10:30:00.000Z",
  "scrapedAt": "2025-01-15T12:00:00.000Z"
}
```

### Comment Data
```json
{
  "dataType": "comment",
  "id": "t1_def456",
  "parsedId": "def456",
  "url": "https://www.reddit.com/r/.../comments/...",
  "postId": "t3_abc123",
  "parentId": "t3_abc123",
  "username": "commenter",
  "userId": "t2_uvw321",
  "category": "subreddit",
  "communityName": "r/subreddit",
  "body": "Comment text...",
  "html": "<div>Comment HTML...</div>",
  "createdAt": "2025-01-15T11:00:00.000Z",
  "scrapedAt": "2025-01-15T12:00:00.000Z",
  "upVotes": 56,
  "numberOfreplies": 3
}
```

### Community Data
```json
{
  "dataType": "community",
  "id": "t5_ghi789",
  "parsedId": "ghi789",
  "communityName": "r/subreddit",
  "parsedCommunityName": "subreddit",
  "title": "Subreddit Title",
  "url": "https://www.reddit.com/r/subreddit/",
  "subscribers": 150000,
  "description": "Subreddit description...",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "scrapedAt": "2025-01-15T12:00:00.000Z",
  "over18": false,
  "iconUrl": "https://...",
  "bannerUrl": "https://...",
  "activeUsers": 500
}
```

## Usage Examples

### Example 1: Scrape Recent Posts from a Subreddit
```json
{
  "startUrls": [
    { "url": "https://www.reddit.com/r/technology/" }
  ],
  "maxPostCount": 50,
  "maxCommentsPerPost": 10,
  "sort": "new",
  "maxPostAgeDays": 7
}
```

### Example 2: Search for Posts About a Topic
```json
{
  "searchQuery": "artificial intelligence",
  "searchPosts": true,
  "ignoreStartUrls": true,
  "maxPostCount": 100,
  "sort": "top",
  "time": "week"
}
```

### Example 3: Scrape User's Posts
```json
{
  "startUrls": [
    { "url": "https://www.reddit.com/user/username/" }
  ],
  "maxPostCount": 25,
  "skipComments": true,
  "sort": "new"
}
```

### Example 4: Deep Dive into Specific Post
```json
{
  "startUrls": [
    { "url": "https://www.reddit.com/r/AskReddit/comments/abc123/" }
  ],
  "maxPostCount": 1,
  "maxCommentsPerPost": 500
}
```

### Example 5: Search Communities and Users
```json
{
  "searchQuery": "machine learning",
  "searchCommunities": true,
  "ignoreStartUrls": true,
  "maxPostCount": 20
}
```

## Tips & Best Practices

1. **Rate Limiting**: Use proxies (enabled by default) to avoid rate limiting when scraping large amounts of data
2. **Pagination**: Use `startPage` and `endPage` to scrape specific sections of subreddits
3. **Date Filtering**: Combine `maxPostAgeDays` with `sort: "new"` for recent content
4. **Comment Depth**: Set `maxCommentsPerPost: 0` if you only need post data without comments
5. **Debug Mode**: Enable `debugMode: true` to troubleshoot issues and see detailed logs
6. **Search Efficiency**: Use `ignoreStartUrls: true` when you only want search results
7. **NSFW Content**: Set `includeNSFW: true` only if your use case requires it

## Limitations

- Maximum 10,000 posts per run
- Maximum 1,000 comments per post
- Stickied posts are automatically skipped
- Deleted and removed comments are filtered out
- Reddit's JSON API has inherent rate limits

## Error Handling

The scraper includes robust error handling:
- Automatic retries for failed requests (configurable)
- Graceful handling of deleted content
- Validation of input parameters
- Detailed error logging in debug mode

## Performance

- **Concurrency**: Adjust `maxConcurrency` based on your needs (default: 10)
- **Proxy Support**: Built-in Apify proxy support for high-volume scraping
- **Memory Efficient**: Streams data to output as it's scraped

## Privacy & Ethics

This scraper accesses only publicly available data through Reddit's JSON API. Please:
- Respect Reddit's Terms of Service
- Don't overwhelm Reddit's servers with excessive requests
- Use the data responsibly and ethically
- Consider user privacy when handling scraped data

## Support

For issues, questions, or feature requests, please refer to the actor's support channels on the Apify platform.