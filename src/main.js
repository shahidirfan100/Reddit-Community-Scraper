import { Actor, log } from "apify";
import { CheerioCrawler } from "crawlee";

await Actor.init();

// Get input
const input = await Actor.getInput();
const debugMode = input?.debugMode === true;

// Keep logs lean unless debugging is explicitly turned on
if (!debugMode) {
  log.setLevel(log.LEVELS.ERROR);
}

if (debugMode) {
  console.log("Current run ID:", Actor.getEnv().actorRunId);
}

const startUrls = input?.startUrls || [
  { url: "https://www.reddit.com/r/all/" },
];
const skipUserPosts = false; //input?.skipUserPosts === true;
// const skipCommunity = input?.skipCommunity === true;
const ignoreStartUrls = input?.ignoreStartUrls === true;
const searches = input?.searches || [];
const searchPosts = input?.searchPosts !== false; // default true
const searchCommunities = input?.searchCommunities === true;
const searchUsers = input?.searchUsers === true;
const searchComments = input?.searchComments === true;
const sort = input?.sort || "new";
const time = input?.time || "all";
const includeNSFW = input?.includeNSFW !== false; // default true
const maxItems = input?.maxPostCount || 10; // max PostCount
const maxPostCount = input?.maxPostCount || 10; // max PostCount
const maxComments = input?.maxCommentsPerPost !== undefined ? input.maxCommentsPerPost : 2;
const maxCommunitiesCount =
  input?.maxCommunitiesCount !== undefined ? input.maxCommunitiesCount : 2;
const maxUserCount = input?.maxUserCount !== undefined ? input.maxUserCount : 2;
const postDateLimit = input?.postDateLimit || null;
const maxPostAgeDays = input?.maxPostAgeDays !== undefined ? input.maxPostAgeDays : null;
const startPage = input?.startPage || 1;
const endPage = input?.endPage || null;
const skipComments = input?.skipComments === true;
const maxRequestRetries = input?.maxRequestRetries || 3;
const maxConcurrency = input?.maxConcurrency || 10;
const proxyInput = input?.proxy || {
  useApifyProxy: true,
  apifyProxyGroups: ["RESIDENTIAL"],
};
const scrollTimeout = (input?.scrollTimeout || 40) * 1000; // Convert seconds to milliseconds

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
];

const baseHeaders = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Referer: "https://www.reddit.com/",
  Origin: "https://www.reddit.com",
  Connection: "keep-alive",
};

const pickUserAgent = (session) => {
  if (session?.userData?.ua) return session.userData.ua;
  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
  if (session) session.userData.ua = ua;
  return ua;
};

const shortNavigationPause = () =>
  Actor.sleep(120 + Math.floor(Math.random() * 280));

const blockedStatusCodes = new Set([401, 403, 429, 500, 502, 503, 504, 590]);

// Validate input
if (!ignoreStartUrls && (!startUrls?.length || !Array.isArray(startUrls))) {
  throw new Error("Invalid or missing startUrls in input");
}

if (startPage < 1) {
  throw new Error("startPage must be at least 1");
}

if (endPage !== null && endPage < startPage) {
  throw new Error("endPage must be greater than or equal to startPage");
}

if (debugMode) {
  console.log("=== DEBUG MODE ENABLED ===");
  console.log(
    "Configuration:",
    JSON.stringify(
      {
        startUrls: startUrls.length,
        // skipUserPosts,
        // skipCommunity,
        ignoreStartUrls,
        searches,
        searchPosts,
        searchCommunities,
        searchUsers,
        searchComments,
        sort,
        time,
        includeNSFW,
        maxPostCount,
        maxCommentsPerPost:maxComments,
        // maxCommunitiesCount,
        // maxUserCount,
        postDateLimit,
        maxPostAgeDays,
        startPage,
        endPage,
        skipComments,
        maxRequestRetries,
        maxConcurrency,
        scrollTimeout,
        proxyInput,
      },
      null,
      2
    )
  );
}

// Initialize request queue
const requestQueue = await Actor.openRequestQueue();
let totalPostsScraped = 0;
let totalCommunitiesScraped = 0;
let totalUsersScraped = 0;
let totalCommentsScraped = 0;
let totalItemsPushed = 0;

const effectiveStartUrls = !ignoreStartUrls ? startUrls.filter(urlObj => {
  let url = typeof urlObj === "string" ? urlObj : urlObj.url;
  if (!url?.includes("reddit.com")) return false;
  
  const isUser = url.includes("/user/") || url.includes("/u/");
  const isCommunity = url.includes("/r/") && !url.includes("/comments/");
  
  if (isUser && skipUserPosts) return false;
  // if (isCommunity && skipCommunity) return false;
  
  return true;
}) : [];

const totalValidUrls = effectiveStartUrls.length || 1;
const postsPerUrl = Math.ceil(maxPostCount / totalValidUrls);
const urlPostCounts = new Map(); // Track posts scraped per URL
const commentCountMap = new Map();

// Store posts temporarily to add comments later
const postsMap = new Map();

// Helper function to check if we can push more items
function canPushMoreItems() {
  return totalItemsPushed < maxItems;
}
function canPushMoreCommentsItems(postId) {
  return (commentCountMap.get(postId) ?? 0) < maxComments;
}
function incrementCommentCountLimit(postId) {
  let currentCommentCount = (commentCountMap.get(postId) ?? 0);
  commentCountMap.set(postId, currentCommentCount + 1);
}
// Helper function to check if URL can scrape more posts
function canUrlScrapeMorePosts(baseUrl) {
  if (!baseUrl) return totalPostsScraped < maxPostCount;
  const currentCount = urlPostCounts.get(baseUrl) || 0;
  return currentCount < postsPerUrl && totalPostsScraped < maxPostCount;
}

function incrementUrlPostCount(baseUrl) {
  if (!baseUrl) return;
  const currentCount = urlPostCounts.get(baseUrl) || 0;
  urlPostCounts.set(baseUrl, currentCount + 1);
}

// Helper function to check if post meets date limit
function meetsDateLimit(post) {
  if (!postDateLimit) return true;

  const postDate = post.created_utc ? new Date(post.created_utc * 1000) : null;
  if (!postDate) return true;

  const limitDate = new Date(postDateLimit);
  return postDate >= limitDate;
}

function debugPostTimestamps(post, title) {
  console.log(`\n🔍 TIMESTAMP DEBUG for: "${title}"`);
  console.log('Available timestamp fields:');
  
  const timestampFields = ['created_utc', 'created', 'retrieved_utc', 'retrieved_on'];
  
  timestampFields.forEach(field => {
    if (post[field]) {
      const asSeconds = new Date(post[field] * 1000);
      const asMilliseconds = new Date(post[field]);
      
      console.log(`\n${field}: ${post[field]}`);
      console.log(`  As seconds: ${asSeconds}`);
      console.log(`  As milliseconds: ${asMilliseconds}`);
      console.log(`  Field type: ${post[field] > 10000000000 ? 'MILLISECONDS?' : 'SECONDS?'}`);
    }
  });
  
  // Also check if there are any other numeric fields that might be timestamps
  Object.keys(post).forEach(key => {
    if (typeof post[key] === 'number' && post[key] > 1000000000 && !timestampFields.includes(key)) {
      console.log(`\n⚠️  Potential timestamp field "${key}": ${post[key]}`);
      console.log(`  As seconds: ${new Date(post[key] * 1000)}`);
      console.log(`  As milliseconds: ${new Date(post[key])}`);
    }
  });
}

// Helper function to check if post meets maxPostAgeDays
function meetsFilterPostDays(post) {
  if (maxPostAgeDays === null || maxPostAgeDays === undefined) return true;

  // Debug first
  if (debugMode && post.title) {
    debugPostTimestamps(post, post.title);
  }

  let postDate;
  
  // Try different timestamp fields in priority order
  if (post.created_utc) {
    postDate = new Date(post.created_utc * 1000); // Always treat as seconds first
  } else if (post.created) {
    postDate = new Date(post.created * 1000); // Always treat as seconds first
  } else {
    if (debugMode) console.log('   No timestamp found, including post');
    return true; // No date info, include the post
  }

  if (!postDate || isNaN(postDate.getTime())) {
    if (debugMode) console.log('   Invalid date, including post');
    return true;
  }

  const now = new Date();
  const daysDifference = Math.floor((now - postDate) / (1000 * 60 * 60 * 24));
  const meetsCriteria = daysDifference <= maxPostAgeDays;

  if (debugMode) {
    console.log(`📅 Date Check - Post: "${post.title?.substring(0, 50)}..."`);
    console.log(`   Post Date: ${postDate}`);
    console.log(`   Now: ${now}`);
    console.log(`   Days Difference: ${daysDifference}`);
    console.log(`   Filter Days: ${maxPostAgeDays}`);
    console.log(`   Meets Criteria: ${meetsCriteria}`);
    
    if (daysDifference < 0) {
      console.log(`   ⚠️  POST IS FROM THE FUTURE!`);
    }
  }

  return meetsCriteria;
}

// Handle search mode
if (searches && Array.isArray(searches) && searches.length > 0) {
  for (const searchQuery of searches) {
    const query =
      typeof searchQuery === "string"
        ? searchQuery
        : searchQuery.query || searchQuery.url;
    if (!query) continue;

    if (debugMode) {
      console.log(`Search mode activated for query: "${query}"`);
    }

    if (searchPosts) {
      let searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        query
      )}&type=link&sort=${sort}`;
      if (sort === "top" && time !== "all") {
        searchUrl += `&t=${time}`;
      }
      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: 1,
          type: "search_posts",
          query: query,
        },
      });
      if (debugMode) console.log("Added search posts URL");
    }

    if (searchCommunities) {
      const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        query
      )}&type=sr&sort=${sort}`;
      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: 1,
          type: "search_communities",
          query: query,
        },
      });
      if (debugMode) console.log("Added search communities URL");
    }

    if (searchUsers) {
      const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        query
      )}&type=user`;
      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: 1,
          type: "search_users",
          query: query,
        },
      });
      if (debugMode) console.log("Added search users URL");
    }

    if (searchComments) {
      const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        query
      )}&type=comment&sort=${sort}`;
      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: 1,
          type: "search_comments",
          query: query,
        },
      });
      if (debugMode) console.log("Added search comments URL");
    }
  }
}

// Handle start URLs if not ignored
if (!ignoreStartUrls) {
  for (const urlObj of startUrls) {
    let url = typeof urlObj === "string" ? urlObj : urlObj.url;

    if (url?.includes("reddit.com")) {
      url = url.replace(/\/$/, "");

      // Detect URL type
      const isPost = url.includes("/comments/");
      const isUser = url.includes("/user/") || url.includes("/u/");
      const isCommunity = url.includes("/r/") && !isPost;

      if (isUser && skipUserPosts) {
        if (debugMode) console.log(`Skipping user URL: ${url}`);
        continue;
      }

      // if (isCommunity && skipCommunity) {
      //   console.log(`Skipping community URL: ${url}`);
      //   continue;
      // }

      if (!url.endsWith(".json")) {
        url = `${url}.json`;
      }

      if (isCommunity && !url.includes("?")) {
        url = `${url}?sort=${sort}`;
        if (sort === "top" && time !== "all") {
          url += `&t=${time}`;
        }
      }

      await requestQueue.addRequest({
        url,
        userData: {
          page: startPage,
          baseUrl: url.split("?")[0].replace(".json", ""),
          isPost,
          isUser,
          isCommunity,
          type: isUser ? "user" : isPost ? "post" : "community",
        },
      });

      if (debugMode) {
        console.log(
          `Added URL: ${url} (Type: ${
            isUser ? "user" : isPost ? "post" : "community"
          })`
        );
      }
    }
  }
}

// Create proxy configuration
const proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);

// Create CheerioCrawler
const crawler = new CheerioCrawler({
  proxyConfiguration,
  requestQueue,
  maxRequestRetries,
  maxConcurrency,
  minConcurrency: Math.min(2, maxConcurrency),
  useSessionPool: true,
  sessionPoolOptions: {
    maxPoolSize: Math.max(10, maxConcurrency * 2),
    sessionOptions: {
      maxUsageCount: 20,
      maxErrorScore: 1,
    },
  },
  persistCookiesPerSession: true,

  additionalMimeTypes: ["application/json"],

  preNavigationHooks: [
    async ({ request, session }) => {
      const ua = pickUserAgent(session);
      request.headers = {
        ...baseHeaders,
        "User-Agent": ua,
        "Cache-Control": "no-cache",
      };
      await shortNavigationPause();
    },
  ],

  requestHandler: async ({ request, json, log, session, response }) => {
    if (debugMode) {
      log.info(`Processing ${request.url} (Type: ${request.userData.type})`);
    }

    if (response?.statusCode && response.statusCode >= 400) {
      if (blockedStatusCodes.has(response.statusCode)) {
        session?.markBad();
      }
      throw new Error(`HTTP ${response.statusCode} for ${request.url}`);
    }

    try {
      const type = request.userData.type;

      switch (type) {
        case "post":
          log.info(`Processing post json : ${json}`);
          await handlePost(json, request, log);
          break;
        case "community":
          await handleCommunityListing(json, request, log);
          break;
        case "user":
          await handleUserPosts(json, request, log);
          break;
        case "search_posts":
          await handleSearchPosts(json, request, log);
          break;
        case "search_communities":
          await handleSearchCommunities(json, request, log);
          break;
        case "search_users":
          await handleSearchUsers(json, request, log);
          break;
        case "search_comments":
          await handleSearchComments(json, request, log);
          break;
        case "comments":
          await handleComments(json, request, log);
          break;
        default:
          // Legacy handling
          if (request.userData.isPost) {
            await handlePost(json, request, log);
          } else if (request.userData.isUser) {
            await handleUserPosts(json, request, log);
          } else {
            await handleCommunityListing(json, request, log);
          }
      }
    } catch (error) {
      log.error(`Failed to process ${request.url}: ${error.message}`);
      if (debugMode) {
        console.error("Full error:", error);
      }
      throw error;
    }
  },

  failedRequestHandler: async ({ request, log, error, session }) => {
    const errorMessage = error?.message || "";
    if (session && (blockedStatusCodes.has(error?.statusCode) || errorMessage.includes("403"))) {
      session.markBad();
    }
    log.error(`Request ${request.url} failed after retries: ${error.message}`);
  },
});

// Handle specific post
async function handlePost(json, request, log) {
  if (!canPushMoreItems()) {
    log.info("Max items limit reached, skipping");
    return;
  }

  if (totalPostsScraped >= maxPostCount) {
    log.info("Max post count reached, skipping");
    return;
  }

  if (!Array.isArray(json) || json.length < 1) {
    log.warning("Invalid post response format");
    return;
  }

  const postListing = json[0];
  const postData = postListing?.data?.children?.[0]?.data;

  if (!postData) {
    log.warning("No post data found");
    return;
  }

  // Skip stickied posts
  if (postData.stickied) {
    if (debugMode) log.info(`Skipping stickied post: ${postData.title}`);
    return;
  }

  if (!includeNSFW && postData.over_18) {
    log.info(`Skipping NSFW post: ${postData.title}`);
    return;
  }

  // Check post date limit
  if (!meetsDateLimit(postData)) {
    if (debugMode)
      log.info(`Skipping post outside date limit: ${postData.title}`);
    return;
  }

  // Check maxPostAgeDays
  if (!meetsFilterPostDays(postData)) {
    if (debugMode)
      log.info(`Skipping post outside maxPostAgeDays: ${postData.title}`);
    return;
  }

  const post = extractPostData(postData);

  // Store post in map
  if (canPushMoreItems()) {
    await Actor.pushData(post);
    totalItemsPushed++;
  } else {
    return;
  }

  log.info(
    `Extracted post: ${post.title} (Total posts: ${totalPostsScraped}/${maxPostCount})`
  );

  // Scrape comments only if maxComments > 0 and not skipping
  if (!skipComments && maxComments > 0 && postData.permalink) {
    const commentsUrl = `https://www.reddit.com${postData.permalink}.json`;
    await requestQueue.addRequest({
      url: commentsUrl,
      userData: {
        type: "comments",
        postId: postData.id,
        postTitle: postData.title,
        communityName: postData.subreddit_name_prefixed || null,
      },
    });
    if (debugMode) {
      log.info(`Added comments URL for post: ${postData.title}`);
    }
  } else {
    // If not scraping comments, push post immediately
    if (canPushMoreItems()) {
      await Actor.pushData(post);
      totalItemsPushed++;
      postsMap.delete(postData.id);
    }
  }
}

// Handle comments - flatten structure and limit per post
async function handleComments(json, request, log) {
  // if (!Array.isArray(json) || json.length < 2) {
  //   log.warning('Invalid comments response format');
  //   // Push post without comments
  //   const postId = request.userData.postId;
  //   const post = postsMap.get(postId);
  //   if (post && canPushMoreItems()) {
  //     await Actor.pushData(post);
  //     totalItemsPushed++;
  //     postsMap.delete(postId);
  //   }
  //   return;
  // }

  const commentsListing = json[1];
  const comments = commentsListing?.data?.children;

  // if (!comments || !Array.isArray(comments)) {
  //   log.warning("No comments found");
  //   // Push post without comments
  //   const postId = request.userData.postId;
  //   const post = postsMap.get(postId);
  //   if (post && canPushMoreItems()) {
  //     await Actor.pushData(post);
  //     totalItemsPushed++;
  //     postsMap.delete(postId);
  //   }
  //   return;
  // }

  const postId = request.userData.postId;
  const postTitle = request.userData.postTitle;
  const communityName = request.userData.communityName;

  // Flatten all comments (no nested structure) with hard cap
  function flattenComments(commentsList) {
    const results = [];

    function recurse(list) {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (results.length >= maxComments) return; // strict cap
        if (item.kind !== "t1") continue;
        const data = item.data;
        if (
          !data ||
          !data.body ||
          data.body === "[deleted]" ||
          data.body === "[removed]"
        )
          continue;

        let numberOfReplies = 0;
        if (
          data.replies &&
          typeof data.replies === "object" &&
          data.replies.data?.children
        ) {
          numberOfReplies = data.replies.data.children.filter(
            (c) => c.kind === "t1"
          ).length;
        }

        const commentData = {
          id: data.name || null,
          parsedId: data.id || null,
          url: data.permalink
            ? `https://www.reddit.com${data.permalink}`
            : null,
          postId: `t3_${postId}`,
          parentId: data.parent_id || null,
          username: data.author || null,
          userId: data.author_fullname || null,
          category: communityName?.replace("r/", "") || null,
          communityName: communityName || null,
          body: data.body || null,
          createdAt: data.created_utc
            ? new Date(data.created_utc * 1000).toISOString()
            : null,
          scrapedAt: new Date().toISOString(),
          upVotes: data.score || 0,
          numberOfreplies: numberOfReplies,
          html: data.body_html
            ? data.body_html
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
            : null,
          dataType: "comment",
        };

        results.push(commentData);

        if (results.length >= maxComments) return; // stop immediately if cap reached

        if (
          data.replies &&
          typeof data.replies === "object" &&
          data.replies.data?.children
        ) {
          recurse(data.replies.data.children);
        }

        if (results.length >= maxComments) return;
      }
    }

    recurse(commentsList);
    return results;
  }

  const extractedComments = flattenComments(comments).slice(0, maxComments); // defensive slice
  const commentCount = extractedComments.length;
  let pushedComments = 0;

  // Then push comments up to the limit
  for (const comment of extractedComments) {
    if (!canPushMoreCommentsItems(postId)) {
      log.info(`Reached max comments limit for post ${postId}. Stopping comment push.`);
      break;
    }
    await Actor.pushData(comment);
    incrementCommentCountLimit(postId);
    pushedComments++;
  }

  totalCommentsScraped += pushedComments;

  log.info(
    `Extracted ${pushedComments} comments for post: ${postTitle} (Total comments: ${totalCommentsScraped}, Total items: ${totalItemsPushed}/${maxItems})`
  );
}

// Handle community/subreddit listing
async function handleCommunityListing(json, request, log) {
    const currentPage = request.userData.page || 1;
    const baseUrl = request.userData.baseUrl;
  
    // Check if we should skip this page based on startPage
    if (currentPage < startPage) {
      if (debugMode)
        log.info(`Skipping page ${currentPage} (startPage=${startPage}), continuing to next page`);
      
      // Don't scrape, just paginate to reach startPage
      const after = json?.data?.after;
      if (after) {
        let nextUrl = `${baseUrl}.json?sort=${sort}&after=${after}`;
        if (sort === "top" && time !== "all") {
          nextUrl += `&t=${time}`;
        }
        await requestQueue.addRequest({
          url: nextUrl,
          userData: {
            page: currentPage + 1,
            baseUrl: baseUrl,
            type: "community",
          },
        });
      }
      return;
    }
  
    // Check if we've exceeded endPage
    if (endPage !== null && currentPage > endPage) {
      log.info(`Reached endPage limit (${endPage}). Stopping pagination.`);
      return;
    }
  
    if (!canPushMoreItems()) {
      log.info("Max items limit reached, stopping");
      return;
    }
  
    if (!canUrlScrapeMorePosts(baseUrl)) {
      const urlCount = urlPostCounts.get(baseUrl) || 0;
      log.info(`URL reached its post limit (${urlCount}/${postsPerUrl}). Stopping pagination for this URL.`);
      return;
    }
  
    const data = json?.data;
    if (!data) {
      log.warning("No data in response");
      return;
    }
  
    const children = data.children;
    if (!children || !Array.isArray(children)) {
      log.warning("No children found in response");
      return;
    }
  
    let postCount = 0;
    for (const child of children) {
      if (!canPushMoreItems()) {
        log.info(`Reached maxItems limit (${maxItems}). Stopping.`);
        break;
      }
      if (!canUrlScrapeMorePosts(baseUrl)) {
        const urlCount = urlPostCounts.get(baseUrl) || 0;
        log.info(`URL reached its post limit (${urlCount}/${postsPerUrl}). Stopping.`);
        break;
      }
  
      if (child.kind !== "t3") continue;
  
      const post = child.data;
  
      // Skip stickied posts
      if (post.stickied) {
        if (debugMode) log.info(`Skipping stickied post: ${post.title}`);
        continue;
      }
  
      if (!includeNSFW && post.over_18) {
        if (debugMode) log.info(`Skipping NSFW post: ${post.title}`);
        continue;
      }
  
      // Check post date limit
      if (!meetsDateLimit(post)) {
        if (debugMode) log.info(`Skipping post outside date limit: ${post.title}`);
        continue;
      }

      // Check maxPostAgeDays
      if (!meetsFilterPostDays(post)) {
        if (debugMode) log.info(`Skipping post outside maxPostAgeDays: ${post.title}`);
        continue;
      }
  
      const postData = extractPostData(post);
  
      // Store post in map
      postsMap.set(post.id, postData);
      postCount++;
      totalPostsScraped++;
      incrementUrlPostCount(baseUrl);
  
      // Scrape comments only if maxComments > 0 and not skipping
      if (!skipComments && maxComments > 0 && post.permalink) {
        const commentsUrl = `https://www.reddit.com${post.permalink}.json`;
        await requestQueue.addRequest({
          url: commentsUrl,
          userData: {
            type: "comments",
            postId: post.id,
            postTitle: post.title,
            communityName: post.subreddit_name_prefixed || null,
          },
        });
      } else {
        // If not scraping comments, push post immediately
        if (canPushMoreItems()) {
          await Actor.pushData(postData);
          totalItemsPushed++;
          postsMap.delete(post.id);
        }
      }
    }
  
    const urlCount = urlPostCounts.get(baseUrl) || 0;
    log.info(
      `Extracted ${postCount} posts from page ${currentPage} (URL: ${urlCount}/${postsPerUrl}, Total: ${totalPostsScraped}/${maxPostCount}, Items: ${totalItemsPushed}/${maxItems})`
    );
  
    // Handle pagination
    if (canPushMoreItems() && canUrlScrapeMorePosts(baseUrl)) {
      const after = data.after;
  
      if (after && (endPage === null || currentPage < endPage)) {
        let nextUrl = `${baseUrl}.json?sort=${sort}&after=${after}`;
        if (sort === "top" && time !== "all") {
          nextUrl += `&t=${time}`;
        }
  
        await requestQueue.addRequest({
          url: nextUrl,
          userData: {
            page: currentPage + 1,
            baseUrl: baseUrl,
            type: "community",
          },
        });
  
        if (debugMode) {
          log.info(`Added page ${currentPage + 1} to queue`);
        }
      } else if (endPage !== null && currentPage >= endPage) {
        log.info(`Reached endPage (${endPage}). No more pages will be added.`);
      }
    }
  }


// Handle user posts
async function handleUserPosts(json, request, log) {
  if (skipUserPosts) {
    log.info("Skipping user posts (skipUserPosts=true)");
    return;
  }

  const currentPage = request.userData.page || 1;
  const baseUrl = request.userData.baseUrl;

  // Check page range
  if (currentPage < startPage) {
    if (debugMode)
      log.info(`Skipping page ${currentPage} (startPage=${startPage}), continuing to next page`);
    
    // Don't scrape, just paginate to reach startPage
    const after = json?.data?.after;
    if (after) {
      const nextUrl = `${baseUrl}.json?after=${after}`;
      await requestQueue.addRequest({
        url: nextUrl,
        userData: {
          page: currentPage + 1,
          baseUrl: baseUrl,
          type: "user",
        },
      });
    }
    return;
  }

  if (endPage !== null && currentPage > endPage) {
    log.info(`Reached endPage limit (${endPage}). Stopping pagination.`);
    return;
  }

  if (!canPushMoreItems()) {
    log.info("Max items limit reached, stopping");
    return;
  }

  if (!canUrlScrapeMorePosts(baseUrl)) {
    const urlCount = urlPostCounts.get(baseUrl) || 0;
    log.info(`URL reached its post limit (${urlCount}/${postsPerUrl}). Stopping.`);
    return;
  }

  const data = json?.data;

  if (!data) {
    log.warning("No data in user response");
    return;
  }

  const children = data.children;

  if (!children || !Array.isArray(children)) {
    log.warning("No children found in user response");
    return;
  }

  let postCount = 0;
  for (const child of children) {
    if (!canPushMoreItems()) break;
    if (!canUrlScrapeMorePosts(baseUrl)) break;

    if (child.kind !== "t3") continue;

    const post = child.data;

    // Skip stickied posts
    if (post.stickied) {
      if (debugMode) log.info(`Skipping stickied post: ${post.title}`);
      continue;
    }

    if (!includeNSFW && post.over_18) {
      if (debugMode) log.info(`Skipping NSFW post: ${post.title}`);
      continue;
    }

    // Check post date limit
    if (!meetsDateLimit(post)) {
      if (debugMode)
        log.info(`Skipping post outside date limit: ${post.title}`);
      continue;
    }

    // Check maxPostAgeDays
    if (!meetsFilterPostDays(post)) {
      if (debugMode)
        log.info(`Skipping post outside maxPostAgeDays: ${post.title}`);
      continue;
    }

    const postData = extractPostData(post);

    // Store post in map
    postsMap.set(post.id, postData);
    postCount++;
    totalPostsScraped++;
    incrementUrlPostCount(baseUrl);

    // Scrape comments only if maxComments > 0 and not skipping
    if (!skipComments && maxComments > 0 && post.permalink) {
      const commentsUrl = `https://www.reddit.com${post.permalink}.json`;
      await requestQueue.addRequest({
        url: commentsUrl,
        userData: {
          type: "comments",
          postId: post.id,
          postTitle: post.title,
          communityName: post.subreddit_name_prefixed || null,
        },
      });
    } else {
      // If not scraping comments, push post immediately
      if (canPushMoreItems()) {
        await Actor.pushData(postData);
        totalItemsPushed++;
        postsMap.delete(post.id);
      }
    }
  }

  const urlCount = urlPostCounts.get(baseUrl) || 0;
  log.info(
    `Extracted ${postCount} posts from user page ${currentPage} (URL: ${urlCount}/${postsPerUrl}, Total: ${totalPostsScraped}/${maxPostCount})`
  );

  // Handle pagination for user posts
  if (canPushMoreItems() && canUrlScrapeMorePosts(baseUrl)) {
    const after = data.after;

    if (after && (endPage === null || currentPage < endPage)) {
      const nextUrl = `${baseUrl}.json?after=${after}`;

      await requestQueue.addRequest({
        url: nextUrl,
        userData: {
          page: currentPage + 1,
          baseUrl: baseUrl,
          type: "user",
        },
      });
    }
  }
}

// Handle search posts
async function handleSearchPosts(json, request, log) {
  const currentPage = request.userData.page || 1;

  // Check page range
  if (currentPage < startPage) {
    if (debugMode)
      log.info(`Skipping page ${currentPage} (startPage=${startPage}), continuing to next page`);
    
    // Don't scrape, just paginate to reach startPage
    const after = json?.data?.after;
    if (after) {
      let searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        request.userData.query
      )}&type=link&sort=${sort}&after=${after}`;
      if (sort === "top" && time !== "all") {
        searchUrl += `&t=${time}`;
      }
      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: currentPage + 1,
          type: "search_posts",
          query: request.userData.query,
        },
      });
    }
    return;
  }
  if (endPage !== null && currentPage > endPage) {
    log.info(`Reached endPage limit (${endPage}). Stopping pagination.`);
    return;
  }

  if (!canPushMoreItems()) {
    log.info("Max items limit reached, stopping");
    return;
  }

  if (totalPostsScraped >= maxPostCount) {
    log.info("Max post count reached, skipping search results");
    return;
  }

  const data = json?.data;

  if (!data) {
    log.warning("No data in search response");
    return;
  }

  const children = data.children;

  if (!children || !Array.isArray(children)) {
    log.warning("No children found in search response");
    return;
  }

  let postCount = 0;
  for (const child of children) {
    if (!canPushMoreItems()) break;
    if (totalPostsScraped >= maxPostCount) break;

    if (child.kind !== "t3") continue;

    const post = child.data;

    // Skip stickied posts
    if (post.stickied) {
      if (debugMode) log.info(`Skipping stickied post: ${post.title}`);
      continue;
    }

    if (!includeNSFW && post.over_18) {
      if (debugMode) log.info(`Skipping NSFW post: ${post.title}`);
      continue;
    }

    // Check post date limit
    if (!meetsDateLimit(post)) {
      if (debugMode)
        log.info(`Skipping post outside date limit: ${post.title}`);
      continue;
    }

    // Check maxPostAgeDays
    if (!meetsFilterPostDays(post)) {
      if (debugMode)
        log.info(`Skipping post outside maxPostAgeDays: ${post.title}`);
      continue;
    }

    const postData = extractPostData(post);

    // Store post in map
    postsMap.set(post.id, postData);
    postCount++;
    totalPostsScraped++;

    // Scrape comments only if maxComments > 0 and not skipping
    if (!skipComments && maxComments > 0 && post.permalink) {
      const commentsUrl = `https://www.reddit.com${post.permalink}.json`;
      await requestQueue.addRequest({
        url: commentsUrl,
        userData: {
          type: "comments",
          postId: post.id,
          postTitle: post.title,
          communityName: post.subreddit_name_prefixed || null,
        },
      });
    } else {
      // If not scraping comments, push post immediately
      if (canPushMoreItems()) {
        await Actor.pushData(postData);
        totalItemsPushed++;
        postsMap.delete(post.id);
      }
    }
  }

  log.info(
    `Extracted ${postCount} posts from search page ${currentPage} (Total: ${totalPostsScraped}/${maxPostCount})`
  );

  // Handle pagination for search
  if (canPushMoreItems() && totalPostsScraped < maxPostCount) {
    const after = data.after;

    if (after && (endPage === null || currentPage < endPage)) {
      let searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        request.userData.query
      )}&type=link&sort=${sort}&after=${after}`;
      if (sort === "top" && time !== "all") {
        searchUrl += `&t=${time}`;
      }

      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: currentPage + 1,
          type: "search_posts",
          query: request.userData.query,
        },
      });
    }
  }
}

// Handle search communities
async function handleSearchCommunities(json, request, log) {
  if (!canPushMoreItems()) {
    log.info("Max items limit reached, stopping");
    return;
  }

  if (totalCommunitiesScraped >= maxCommunitiesCount) {
    log.info("Max communities count reached, skipping");
    return;
  }

  const data = json?.data;

  if (!data) {
    log.warning("No data in communities search response");
    return;
  }

  const children = data.children;

  if (!children || !Array.isArray(children)) {
    log.warning("No children found in communities search response");
    return;
  }

  let communityCount = 0;
  for (const child of children) {
    if (!canPushMoreItems()) break;
    if (totalCommunitiesScraped >= maxCommunitiesCount) break;

    if (child.kind !== "t5") continue;

    const community = child.data;

    const communityData = {
      dataType: "community",
      id: community.name || null,
      parsedId: community.id || null,
      communityName: community.display_name_prefixed || null,
      parsedCommunityName: community.display_name || null,
      title: community.title || null,
      url: community.url ? `https://www.reddit.com${community.url}` : null,
      subscribers: community.subscribers || 0,
      description: community.public_description || null,
      createdAt: community.created_utc
        ? new Date(community.created_utc * 1000).toISOString()
        : null,
      over18: community.over18 || false,
      iconUrl: community.icon_img || null,
      bannerUrl: community.banner_img || null,
      activeUsers: community.accounts_active || 0,
      scrapedAt: new Date().toISOString(),
    };

    await Actor.pushData(communityData);
    totalItemsPushed++;
    communityCount++;
    totalCommunitiesScraped++;
  }

  log.info(
    `Extracted ${communityCount} communities (Total: ${totalCommunitiesScraped}/${maxCommunitiesCount})`
  );

  // Handle pagination for communities
  if (canPushMoreItems() && totalCommunitiesScraped < maxCommunitiesCount) {
    const after = data.after;

    if (after) {
      const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        request.userData.query
      )}&type=sr&sort=${sort}&after=${after}`;

      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: (request.userData.page || 1) + 1,
          type: "search_communities",
          query: request.userData.query,
        },
      });
    }
  }
}

// Handle search users
async function handleSearchUsers(json, request, log) {
  if (!canPushMoreItems()) {
    log.info("Max items limit reached, stopping");
    return;
  }

  if (totalUsersScraped >= maxUserCount) {
    log.info("Max users count reached, skipping");
    return;
  }

  const data = json?.data;

  if (!data) {
    log.warning("No data in users search response");
    return;
  }

  const children = data.children;

  if (!children || !Array.isArray(children)) {
    log.warning("No children found in users search response");
    return;
  }

  let userCount = 0;
  for (const child of children) {
    if (!canPushMoreItems()) break;
    if (totalUsersScraped >= maxUserCount) break;

    if (child.kind !== "t2") continue;

    const user = child.data;

    const userData = {
      dataType: "user",
      userId: user.name || null,
      parsedUserId: user.id || null,
      username: user.name || null,
      iconUrl: user.icon_img || null,
      linkKarma: user.link_karma || 0,
      commentKarma: user.comment_karma || 0,
      createdAt: user.created_utc
        ? new Date(user.created_utc * 1000).toISOString()
        : null,
      isGold: user.is_gold || false,
      isMod: user.is_mod || false,
      verified: user.verified || false,
      scrapedAt: new Date().toISOString(),
    };

    await Actor.pushData(userData);
    totalItemsPushed++;
    userCount++;
    totalUsersScraped++;
  }

  log.info(
    `Extracted ${userCount} users (Total: ${totalUsersScraped}/${maxUserCount})`
  );

  // Handle pagination for users
  if (canPushMoreItems() && totalUsersScraped < maxUserCount) {
    const after = data.after;

    if (after) {
      const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        request.userData.query
      )}&type=user&after=${after}`;

      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: (request.userData.page || 1) + 1,
          type: "search_users",
          query: request.userData.query,
        },
      });
    }
  }
}

// Handle search comments
async function handleSearchComments(json, request, log) {
  const currentPage = request.userData.page || 1;

  if (!canPushMoreItems()) {
    log.info("Max items limit reached, stopping");
    return;
  }

  // if (totalCommentsScraped >= maxItems) {
  //   log.info("Max comments limit reached, skipping search results");
  //   return;
  // }

  const data = json?.data;

  if (!data) {
    log.warning("No data in search comments response");
    return;
  }

  const children = data.children;

  if (!children || !Array.isArray(children)) {
    log.warning("No children found in search comments response");
    return;
  }

  let commentCount = 0;
  let pushedComments = 0;
  for (const child of children) {
    if (child.kind !== "t1") continue;

    const comment = child.data;
    const postInfo = comment?.link_title
      ? { title: comment.link_title, id: comment.link_id?.replace("t3_", "") }
      : null;
    const postKey = postInfo?.id;

    if (postKey && !canPushMoreCommentsItems(postKey)) {
      continue;
    }

    // Skip deleted or removed comments
    if (
      !comment ||
      !comment.body ||
      comment.body === "[deleted]" ||
      comment.body === "[removed]"
    ) {
      continue;
    }

    const communityName = comment.subreddit_name_prefixed || null;

    const commentData = {
      id: comment.name || null,
      parsedId: comment.id || null,
      url: comment.permalink
        ? `https://www.reddit.com${comment.permalink}`
        : null,
      postId: postInfo?.id ? `t3_${postInfo.id}` : null,
      parentId: comment.parent_id || null,
      username: comment.author || null,
      userId: comment.author_fullname || null,
      category: communityName?.replace("r/", "") || null,
      communityName: communityName || null,
      body: comment.body || null,
      createdAt: comment.created_utc
        ? new Date(comment.created_utc * 1000).toISOString()
        : null,
      scrapedAt: new Date().toISOString(),
      upVotes: comment.score || 0,
      numberOfreplies: comment.num_replies || 0,
      html: comment.body_html
        ? comment.body_html
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
        : null,
      dataType: "comment",
    };

    await Actor.pushData(commentData);
    // totalItemsPushed++;
    commentCount++;
    pushedComments++;
    if (postKey) incrementCommentCountLimit(postKey);
  }

  totalCommentsScraped += pushedComments;

  log.info(
    `Extracted ${pushedComments} comments from search page ${currentPage} (Total: ${totalCommentsScraped})`
  );

  // Handle pagination for search comments
  if (canPushMoreItems()) {
    const after = data.after;

    if (after) {
      let searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
        request.userData.query
      )}&type=comment&sort=${sort}&after=${after}`;
      if (sort === "top" && time !== "all") {
        searchUrl += `&t=${time}`;
      }

      await requestQueue.addRequest({
        url: searchUrl,
        userData: {
          page: currentPage + 1,
          type: "search_comments",
          query: request.userData.query,
        },
      });
    }
  }
}

// Extract images from post
function extractImages(post) {
  const images = [];

  // Check preview images
  if (post.preview?.images?.[0]) {
    const previewImage = post.preview.images[0];
    if (previewImage.source?.url) {
      images.push(previewImage.source.url.replace(/&amp;/g, "&"));
    }
  }

  // Check media metadata (for galleries)
  if (post.media_metadata) {
    Object.values(post.media_metadata).forEach((media) => {
      if (media.s?.u) {
        images.push(media.s.u.replace(/&amp;/g, "&"));
      }
    });
  }

  return images;
}

// Helper function to check if URL is an image
function isImageUrl(url) {
  if (!url) return false;
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
}

// Helper function to check if URL is a Reddit post link
function isRedditPostUrl(url) {
  if (!url) return false;
  return url.includes("reddit.com") || url.startsWith("/r/");
}

// Extract post data helper
function extractPostData(post) {
  const postId = post.id || null;
  const fullId = post.name || null;
  const permalink = post.permalink || null;

  const selftext = post.selftext || "";
  const body = selftext.trim() !== "" ? selftext : null;

  let html = post.selftext_html || null;
  if (html) {
    html = html
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // Get the URL from post
  let postUrl = post.url || null;

  // Determine if this should be in the link field
  // link should only contain external links, NOT images or Reddit links
  let externalLink = null;
  if (postUrl && !isImageUrl(postUrl) && !isRedditPostUrl(postUrl)) {
    externalLink = postUrl;
  }

  return {
    id: fullId,
    parsedId: postId,
    url: permalink ? `https://www.reddit.com${permalink}` : null,
    username: post.author || null,
    userId: post.author_fullname || null,
    title: post.title || null,
    communityName: post.subreddit_name_prefixed || null,
    parsedCommunityName: post.subreddit || null,
    body: body,
    html: html,
    link: externalLink,
    numberOfComments: post.num_comments || 0,
    flair: post.link_flair_text || null,
    upVotes: post.score || 0,
    upVoteRatio: post.upvote_ratio || 0,
    isVideo: post.is_video || false,
    isAd: post.promoted || false,
    over18: post.over_18 || false,
    thumbnailUrl: post.thumbnail || null,
    imageUrls: extractImages(post),
    createdAt: post.created_utc
      ? new Date(post.created_utc * 1000).toISOString()
      : null,
    scrapedAt: new Date().toISOString(),
    dataType: "post",
  };
}

// Run the crawler
await crawler.run();

// Push any remaining posts without comments
for (const [postId, post] of postsMap.entries()) {
  if (canPushMoreItems()) {
    await Actor.pushData(post);
    totalItemsPushed++;
    if (debugMode) {
      console.log(`Pushed remaining post without comments: ${post.title}`);
    }
  }
}

// Log final statistics
console.log("\nReddit scraping finished.");
console.log(
  `Items stored: ${totalItemsPushed} | Posts: ${totalPostsScraped}/${maxPostCount} | Comments: ${totalCommentsScraped} | Communities: ${totalCommunitiesScraped} | Users: ${totalUsersScraped}`
);
console.log(
  `Config -> posts=${maxPostCount}, commentsPerPost=${maxComments}, sort=${sort}, time=${time}, nsfw=${includeNSFW}, pages=${startPage}-${endPage || "unlimited"}`
);

await Actor.exit();
