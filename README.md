# codebot
Posts email list coding problems in Discord using express, discord.js, and gmail API. Problems are sourced from two email accounts accessed with OAuth2 through an Express microservice, more can be added relatively easily. Problems are cached in a dictionary with keyed by problem number. Users may query for the list of problems or for a specific problem getting either the cache key-value listing or the specific keys entry.  

Program cache is updated at 8:35am daily since problems typically are received at 8:32am currently.  

## Current Commands

- `?help`: Get help information
- `?list`: lists the cached coding problems
- `?<number>`: posts the queried coding problem
- `?update`: Manually update cache for problems
