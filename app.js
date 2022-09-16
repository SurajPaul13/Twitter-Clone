const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const path = require("path");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDB = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server is running at http://localhost:3000")
    );
  } catch (e) {
    console.log("DB Error: ${e.message}");
  }
};

initializeDB();

const authentication = (request, response, next) => {
  const headerObj = request.headers["authorization"];
  const jwtToken = headerObj.split(" ")[1];

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "B151681", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// Register a user API 1
app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);

  const validateUsernameQuery = `
    SELECT *
    FROM 
      user
    WHERE username = '${username}';`;

  const userDetails = await db.get(validateUsernameQuery);

  if (userDetails === undefined) {
    if (`${password}`.length >= 5) {
      const registerUserQuery = `
      INSERT INTO
       user(username, password, name, gender)
      VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      await db.run(registerUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2 LOGIN
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;

  const validateUsernameQuery = `
    SELECT *
    FROM 
      user
    WHERE username = '${username}';`;
  const userDetails = await db.get(validateUsernameQuery);

  if (userDetails === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      userDetails.password
    );
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "B151681");
      console.log(jwtToken);
      response.send({
        jwtToken: jwtToken,
      });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Get tweets of people the user follows API 3
app.get("/user/tweets/feed/", authentication, async (request, response) => {
  let { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);
  const { user_id } = getUserId;
  const getTweetsQuery = `
  SELECT 
    user.username,tweet.tweet,tweet.date_time
  FROM 
    ( tweet LEFT JOIN user ON tweet.user_id = user.user_id ) AS tweet_user
    LEFT JOIN follower ON follower.following_user_id = tweet.user_id
  WHERE follower.follower_user_id = '${user_id}'
  ORDER BY tweet.tweet_id DESC
  LIMIT 4;
  `;
  const obj = await db.all(getTweetsQuery);
  response.send(obj);
});

// Get the list of all names of people whom the user follows API 4
app.get("/user/following/", authentication, async (request, response) => {
  let { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);
  const { user_id } = getUserId;
  const getFollowingQuery = `
    SELECT
     user.name
    FROM user
     LEFT JOIN follower ON user.user_id = follower.following_user_id
    WHERE
     follower.follower_user_id = '${user_id}';`;
  const followingList = await db.all(getFollowingQuery);
  response.send(followingList);
});

// Get the list of people who follow user API 5
app.get("/user/following/", authentication, async (request, response) => {
  let { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);
  const { user_id } = getUserId;
  const getFollowerQuery = `
    SELECT
     user.name
    FROM follower
     LEFT JOIN user ON user.user_id = follower.following_user_id
    WHERE
     follower.following_user_id = '${user_id}';`;
  const followerList = await db.all(getFollowerQuery);
  response.send(followerList);
});

// Get specific tweets,likes,replies API 6
app.get("/tweets/:tweetId/", authentication, async (request, response) => {
  const { tweetId } = request.params;
  let { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);
  const { user_id } = getUserId;

  const getFollowingTweetsQuery = `
    SELECT tweet.tweet_id
    FROM user
     LEFT JOIN follower ON user.user_id = follower.following_user_id
     INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE follower.follower_user_id = '${user_id}'
     AND tweet.tweet_id = '${tweetId}';`;
  const followingTweets = await db.get(getFollowingTweetsQuery);

  if (followingTweets !== undefined) {
    const getTweetsLikesQuery = `
    SELECT
      COUNT(tweet.tweet_id) AS likes
    FROM
      tweet LEFT JOIN like ON like.tweet_id = tweet.tweet_id
    WHERE tweet.tweet_id = '${tweetId}';`;
    const objLikes = await db.get(getTweetsLikesQuery);
    const { likes } = objLikes;

    const getTweetsRepliesQuery = `
    SELECT
      tweet.tweet,tweet.date_time AS dateTime,COUNT(tweet.tweet_id) AS replies
    FROM
      tweet LEFT JOIN reply ON reply.tweet_id = tweet.tweet_id
    WHERE tweet.tweet_id = '${tweetId}';`;
    const objRepliesAndDate = await db.get(getTweetsRepliesQuery);
    const { tweet, dateTime, replies } = objRepliesAndDate;

    response.send({
      tweet: tweet,
      likes: likes,
      replies: replies,
      dateTime: dateTime,
    });
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//API 7 Get the list of usernames who liked the tweet of a user he is following
app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  async (request, response) => {
    let { username } = request;
    const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
    const getUserId = await db.get(getUserIdQuery);
    const { user_id } = getUserId;
    const { tweetId } = request.params;
    const getFollowingTweetsQuery = `
    SELECT tweet.tweet_id
    FROM user
     LEFT JOIN follower ON user.user_id = follower.following_user_id
     INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE follower.follower_user_id = '${user_id}'
     AND tweet.tweet_id = '${tweetId}';`;
    const followingTweets = await db.get(getFollowingTweetsQuery);

    if (followingTweets !== undefined) {
      const getLikersNameQuery = `
        SELECT user.name
        FROM like LEFT JOIN user ON like.user_id = user.user_id
        WHERE like.tweet_id = '${tweetId}';`;
      const obj = await db.all(getLikersNameQuery);
      response.send(
        obj.map((eachItem) => {
          return eachItem.name;
        })
      );
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 8 Get the list of replies, if the user requests a tweet of a user he is following
app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  async (request, response) => {
    let { username } = request;
    const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
    const getUserId = await db.get(getUserIdQuery);
    const { user_id } = getUserId;
    const { tweetId } = request.params;

    const getFollowingTweetsQuery = `
    SELECT tweet.tweet_id
    FROM user
     LEFT JOIN follower ON user.user_id = follower.following_user_id
     INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE follower.follower_user_id = '${user_id}'
     AND tweet.tweet_id = '${tweetId}';`;
    const followingTweets = await db.get(getFollowingTweetsQuery);

    if (followingTweets !== undefined) {
      const getReplyNames = `
      SELECT
       user.name, reply.reply
      FROM reply
       LEFT JOIN user ON reply.user_id = user.user_id
      WHERE
       reply.tweet_id = '${tweetId}';`;

      const replyNames = await db.all(getReplyNames);
      const repliesObject = replyNames.map((eachItem) => {
        return {
          name: eachItem.name,
          reply: eachItem.reply,
        };
      });
      response.send({
        replies: repliesObject,
      });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
//API 9 Get the details of each tweet of the user
app.get("/user/tweets/", authentication, async (request, response) => {
  getTweetDetails = async (tweetIdObject) => {
    const { tweet_id } = tweetIdObject;

    const getTweetsLikesQuery = `
        SELECT
        COUNT(tweet.tweet_id) AS likes
        FROM
        tweet LEFT JOIN like ON like.tweet_id = tweet.tweet_id
        WHERE tweet.tweet_id = '${tweet_id}';`;
    const objLikes = await db.get(getTweetsLikesQuery);

    const { likes } = objLikes;

    const getTweetsRepliesQuery = `
        SELECT
        tweet.tweet,tweet.date_time AS dateTime,COUNT(tweet.tweet_id) AS replies
        FROM
        tweet LEFT JOIN reply ON reply.tweet_id = tweet.tweet_id
        WHERE tweet.tweet_id = '${tweet_id}';`;
    const objRepliesAndDate = await db.get(getTweetsRepliesQuery);
    const { tweet, dateTime, replies } = objRepliesAndDate;

    const details = {
      tweet: tweet,
      likes: likes,
      replies: replies,
      dateTime: dateTime,
    };

    return details;
  };

  let { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);
  const { user_id } = getUserId;

  const getUserTweets = `
    SELECT tweet_id
    FROM tweet WHERE user_id = '${user_id}'`;

  const tweetIds = await db.all(getUserTweets);

  const tweetDetails = tweetIds.map((eachTweet) => getTweetDetails(eachTweet));
  console.log(tweetDetails);
  response.send(tweetDetails);
});

// Create tweet API 10

app.post("/user/tweets/", authentication, async (request, response) => {
  const { tweet } = request.body;

  let { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);
  const { user_id } = getUserId;

  const postTweetQuery = `
    INSERT INTO
     tweet(tweet, user_id)
    VALUES ('${tweet}', ${user_id});`;

  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

// Remove user tweet API 11
app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  let { username } = request;
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);
  const { user_id } = getUserId;
  const { tweetId } = request.params;

  const getUserTweets = `
    SELECT
     * 
    FROM
     tweet 
    WHERE
     user_id='${user_id}' AND tweet_id='${tweetId}'`;
  const userTweets = await db.get(getUserTweets);
  if (userTweets !== undefined) {
    const deleteUserTweet = `
    DELETE FROM tweet WHERE tweet_id = ${tweetId}`;

    await db.run(deleteUserTweet);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
