// Stored as a string — Redis executes this atomically via EVALSHA
// KEYS[1] = ratelimit:{org_id}
// ARGV[1] = now (ms timestamp as string)
// ARGV[2] = window size (ms)
// ARGV[3] = limit (max requests)
// ARGV[4] = unique request id
//
// Returns: [allowed (0|1), current_count, limit]

export const SLIDING_WINDOW_SCRIPT = `
local key     = KEYS[1]
local now     = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])
local limit   = tonumber(ARGV[3])
local req_id  = ARGV[4]

local cutoff = now - window

-- Remove entries outside the window (sliding part)
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

-- Count requests currently in window
local count = redis.call('ZCARD', key)

if count >= limit then
  -- Don't add to the set — request is rejected
  return {0, count, limit}
end

-- Add this request with timestamp as score
redis.call('ZADD', key, now, req_id)

-- TTL = window size so Redis auto-cleans idle org keys
redis.call('PEXPIRE', key, window)

return {1, count + 1, limit}
`;
