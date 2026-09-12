import { useState, useRef, useEffect, useCallback } from 'react'
import './CliConsole.css'
import { connBody as buildConnBody } from '../../types'

const REDIS_COMMANDS = [
  // String
  'APPEND', 'DECR', 'DECRBY', 'GET', 'GETDEL', 'GETEX', 'GETRANGE', 'GETSET',
  'INCR', 'INCRBY', 'INCRBYFLOAT', 'MGET', 'MSET', 'MSETNX',
  'PSETEX', 'SET', 'SETEX', 'SETNX', 'SETRANGE', 'STRLEN', 'SUBSTR',
  // Key
  'COPY', 'DEL', 'DUMP', 'EXISTS', 'EXPIRE', 'EXPIREAT', 'EXPIRETIME',
  'KEYS', 'MOVE', 'OBJECT', 'OBJECT ENCODING', 'OBJECT FREQ', 'OBJECT HELP',
  'OBJECT IDLETIME', 'OBJECT REFCOUNT', 'PERSIST', 'PEXPIRE', 'PEXPIREAT',
  'PEXPIRETIME', 'PTTL', 'RANDOMKEY', 'RENAME', 'RENAMENX', 'RESTORE',
  'SCAN', 'SORT', 'SORT_RO', 'TOUCH', 'TTL', 'TYPE', 'UNLINK', 'WAIT',
  // Hash
  'HDEL', 'HEXISTS', 'HGET', 'HGETALL', 'HINCRBY', 'HINCRBYFLOAT',
  'HKEYS', 'HLEN', 'HMGET', 'HMSET', 'HRANDFIELD', 'HSCAN',
  'HSET', 'HSETNX', 'HVALS',
  // List
  'BLMOVE', 'BLPOP', 'BRPOP', 'BRPOPLPUSH', 'LINDEX', 'LINSERT',
  'LLEN', 'LMOVE', 'LMPOP', 'LPOP', 'LPOS', 'LPUSH', 'LPUSHX',
  'LRANGE', 'LREM', 'LSET', 'LTRIM', 'RPOP', 'RPOPLPUSH', 'RPUSH', 'RPUSHX',
  // Set
  'SADD', 'SCARD', 'SDIFF', 'SDIFFSTORE', 'SINTER', 'SINTERCARD', 'SINTERSTORE',
  'SISMEMBER', 'SMEMBERS', 'SMISMEMBER', 'SMOVE', 'SPOP',
  'SRANDMEMBER', 'SREM', 'SUNION', 'SUNIONSTORE',
  // Sorted Set
  'BZMPOP', 'BZPOPMAX', 'BZPOPMIN',
  'ZADD', 'ZCARD', 'ZCOUNT', 'ZDIFF', 'ZDIFFSTORE',
  'ZINCRBY', 'ZINTER', 'ZINTERCARD', 'ZINTERSTORE',
  'ZLEXCOUNT', 'ZMPOP', 'ZMSCORE', 'ZPOPMAX', 'ZPOPMIN',
  'ZRANDMEMBER', 'ZRANGE', 'ZRANGEBYLEX', 'ZRANGEBYSCORE', 'ZRANGESTORE',
  'ZRANK', 'ZREM', 'ZREMRANGEBYLEX', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE',
  'ZREVRANGE', 'ZREVRANGEBYLEX', 'ZREVRANGEBYSCORE', 'ZREVRANK',
  'ZSCORE', 'ZUNION', 'ZUNIONSTORE',
  // HyperLogLog
  'PFADD', 'PFCOUNT', 'PFMERGE',
  // Geo
  'GEOADD', 'GEODIST', 'GEOHASH', 'GEOPOS',
  'GEORADIUS', 'GEORADIUSBYMEMBER', 'GEOSEARCH', 'GEOSEARCHSTORE',
  // Streams
  'XACK', 'XADD', 'XAUTOCLAIM', 'XCLAIM', 'XDEL',
  'XGROUP', 'XGROUP CREATE', 'XGROUP CREATECONSUMER', 'XGROUP DELCONSUMER',
  'XGROUP DESTROY', 'XGROUP SETID',
  'XINFO', 'XINFO CONSUMERS', 'XINFO GROUPS', 'XINFO STREAM',
  'XLEN', 'XPENDING', 'XRANGE', 'XREAD', 'XREADGROUP', 'XREVRANGE', 'XTRIM',
  // Bit
  'BITCOUNT', 'BITFIELD', 'BITFIELD_RO', 'BITOP', 'BITPOS',
  // Scripting
  'EVAL', 'EVAL_RO', 'EVALSHA', 'EVALSHA_RO',
  'FCALL', 'FCALL_RO',
  'FUNCTION', 'FUNCTION DELETE', 'FUNCTION DUMP', 'FUNCTION LIST',
  'FUNCTION LOAD', 'FUNCTION RESTORE', 'FUNCTION STATS',
  'SCRIPT', 'SCRIPT EXISTS', 'SCRIPT FLUSH', 'SCRIPT KILL', 'SCRIPT LOAD',
  // Transaction
  'DISCARD', 'EXEC', 'MULTI', 'UNWATCH', 'WATCH',
  // Pub/Sub
  'PSUBSCRIBE', 'PUBLISH', 'PUBSUB', 'PUBSUB CHANNELS', 'PUBSUB NUMPAT',
  'PUBSUB NUMSUB', 'PUNSUBSCRIBE', 'SUBSCRIBE', 'UNSUBSCRIBE',
  // Server
  'ACL', 'ACL CAT', 'ACL DELUSER', 'ACL GENPASS', 'ACL GETUSER',
  'ACL LIST', 'ACL LOG', 'ACL SAVE', 'ACL SETUSER', 'ACL USERS', 'ACL WHOAMI',
  'AUTH', 'BGREWRITEAOF', 'BGSAVE',
  'CLIENT', 'CLIENT GETNAME', 'CLIENT ID', 'CLIENT INFO',
  'CLIENT KILL', 'CLIENT LIST', 'CLIENT NO-EVICT', 'CLIENT SETNAME',
  'CLIENT UNPAUSE', 'CLIENT CACHING', 'CLIENT PAUSE',
  'CLUSTER', 'CLUSTER INFO', 'CLUSTER KEYSLOT', 'CLUSTER MYID',
  'CLUSTER NODES', 'CLUSTER SHARDS', 'CLUSTER SLOTS',
  'COMMAND', 'COMMAND COUNT', 'COMMAND DOCS', 'COMMAND GETKEYS',
  'COMMAND INFO', 'COMMAND LIST',
  'CONFIG GET', 'CONFIG RESETSTAT', 'CONFIG REWRITE', 'CONFIG SET',
  'DBSIZE', 'DEBUG', 'DEBUG OBJECT', 'DEBUG SLEEP',
  'ECHO', 'FAILOVER', 'FLUSHALL', 'FLUSHDB',
  'INFO', 'LASTSAVE', 'LATENCY', 'LATENCY HISTORY', 'LATENCY LATEST',
  'LATENCY RESET',
  'LOLWUT', 'MEMORY', 'MEMORY DOCTOR', 'MEMORY MALLOC-STATS',
  'MEMORY PURGE', 'MEMORY STATS', 'MEMORY USAGE',
  'MODULE', 'MODULE LIST', 'MODULE LOAD', 'MODULE UNLOAD',
  'MONITOR', 'PING', 'QUIT', 'RANDOMKEY', 'REPLICAOF',
  'RESET', 'ROLE', 'SAVE', 'SELECT',
  'SHUTDOWN', 'SLAVEOF', 'SLOWLOG', 'SLOWLOG GET', 'SLOWLOG LEN', 'SLOWLOG RESET',
  'SWAPDB', 'TIME', 'XADD',
  'HELLO', 'SSUBSCRIBE', 'SUNSUBSCRIBE',
]

const REDIS_HELP: Record<string, { syntax: string; desc: string }> = {
  // String
  APPEND:           { syntax: 'APPEND key value',                              desc: 'Append a value to a key' },
  DECR:             { syntax: 'DECR key',                                      desc: 'Decrement the integer value of a key by one' },
  DECRBY:           { syntax: 'DECRBY key decrement',                          desc: 'Decrement the integer value of a key by the given number' },
  GET:              { syntax: 'GET key',                                        desc: 'Get the value of a key' },
  GETDEL:           { syntax: 'GETDEL key',                                    desc: 'Get the value of a key and delete the key' },
  GETEX:            { syntax: 'GETEX key [EX seconds|PX ms|EXAT ts|PXAT ts|PERSIST]', desc: 'Get the value of a key and optionally set its expiration (Redis 6.2+)' },
  GETRANGE:         { syntax: 'GETRANGE key start end',                        desc: 'Get a substring of the string stored at a key' },
  GETSET:           { syntax: 'GETSET key value',                              desc: 'Set the string value of a key and return its old value (deprecated — use SET GET)' },
  INCR:             { syntax: 'INCR key',                                      desc: 'Increment the integer value of a key by one' },
  INCRBY:           { syntax: 'INCRBY key increment',                          desc: 'Increment the integer value of a key by the given amount' },
  INCRBYFLOAT:      { syntax: 'INCRBYFLOAT key increment',                     desc: 'Increment the float value of a key by the given amount' },
  MGET:             { syntax: 'MGET key [key ...]',                            desc: 'Get the values of all the given keys' },
  MSET:             { syntax: 'MSET key value [key value ...]',                desc: 'Set multiple keys to multiple values' },
  MSETNX:           { syntax: 'MSETNX key value [key value ...]',              desc: 'Set multiple keys to multiple values, only if none of the keys exist' },
  PSETEX:           { syntax: 'PSETEX key milliseconds value',                 desc: 'Set the value and expiration in milliseconds of a key' },
  SET:              { syntax: 'SET key value [EX seconds] [PX ms] [NX|XX] [GET]', desc: 'Set the string value of a key' },
  SETEX:            { syntax: 'SETEX key seconds value',                       desc: 'Set the value and expiration of a key' },
  SETNX:            { syntax: 'SETNX key value',                               desc: 'Set the value of a key, only if the key does not exist' },
  SETRANGE:         { syntax: 'SETRANGE key offset value',                     desc: 'Overwrite part of a string key starting at the specified offset' },
  STRLEN:           { syntax: 'STRLEN key',                                    desc: 'Get the length of the value stored in a key' },
  SUBSTR:           { syntax: 'SUBSTR key start end',                          desc: 'Get a substring of the string stored at a key (alias for GETRANGE)' },
  // Key
  COPY:             { syntax: 'COPY source destination [DB db] [REPLACE]',     desc: 'Copy a key to another key' },
  DEL:              { syntax: 'DEL key [key ...]',                             desc: 'Delete one or more keys' },
  DUMP:             { syntax: 'DUMP key',                                      desc: 'Return a serialized version of the value stored at the key' },
  EXISTS:           { syntax: 'EXISTS key [key ...]',                          desc: 'Determine if one or more keys exist' },
  EXPIRE:           { syntax: 'EXPIRE key seconds [NX|XX|GT|LT]',             desc: 'Set a key\'s time to live in seconds' },
  EXPIREAT:         { syntax: 'EXPIREAT key unix-time-seconds',                desc: 'Set the expiration for a key as a UNIX timestamp' },
  EXPIRETIME:       { syntax: 'EXPIRETIME key',                                desc: 'Get the expiration Unix timestamp for a key in seconds (Redis 7.0+)' },
  KEYS:             { syntax: 'KEYS pattern',                                  desc: 'Find all keys matching the given pattern — blocks server, prefer SCAN in production' },
  MOVE:             { syntax: 'MOVE key db',                                   desc: 'Move a key to another database' },
  OBJECT:           { syntax: 'OBJECT <subcommand> [key]',                     desc: 'Inspect internals of a Redis object — use OBJECT ENCODING, IDLETIME, REFCOUNT' },
  'OBJECT ENCODING':{ syntax: 'OBJECT ENCODING key',                           desc: 'Return the internal encoding of the Redis object stored at key' },
  'OBJECT FREQ':    { syntax: 'OBJECT FREQ key',                               desc: 'Return the access frequency index of a key (only when maxmemory-policy is LFU)' },
  'OBJECT HELP':    { syntax: 'OBJECT HELP',                                   desc: 'Return subcommand help summary' },
  'OBJECT IDLETIME':{ syntax: 'OBJECT IDLETIME key',                           desc: 'Return the idle time of a key (seconds since last access)' },
  'OBJECT REFCOUNT':{ syntax: 'OBJECT REFCOUNT key',                           desc: 'Return the reference count of the object stored at key' },
  PERSIST:          { syntax: 'PERSIST key',                                   desc: 'Remove the expiration from a key' },
  PEXPIRE:          { syntax: 'PEXPIRE key milliseconds',                      desc: 'Set a key\'s time to live in milliseconds' },
  PEXPIREAT:        { syntax: 'PEXPIREAT key unix-time-milliseconds',          desc: 'Set the expiration for a key as a Unix millisecond timestamp' },
  PEXPIRETIME:      { syntax: 'PEXPIRETIME key',                               desc: 'Get the expiration Unix timestamp for a key in milliseconds (Redis 7.0+)' },
  PTTL:             { syntax: 'PTTL key',                                      desc: 'Get the time to live for a key in milliseconds' },
  RANDOMKEY:        { syntax: 'RANDOMKEY',                                     desc: 'Return a random key from the keyspace' },
  RENAME:           { syntax: 'RENAME key newkey',                             desc: 'Rename a key' },
  RENAMENX:         { syntax: 'RENAMENX key newkey',                           desc: 'Rename a key, only if the new key does not exist' },
  RESTORE:          { syntax: 'RESTORE key ttl serialized-value [REPLACE]',    desc: 'Create a key from a DUMP-serialized value' },
  SCAN:             { syntax: 'SCAN cursor [MATCH pattern] [COUNT count] [TYPE type]', desc: 'Incrementally iterate the keyspace — safe for production use' },
  SORT:             { syntax: 'SORT key [BY pattern] [LIMIT offset count] [GET pattern] [ASC|DESC] [ALPHA] [STORE destination]', desc: 'Sort the elements in a list, set or sorted set' },
  SORT_RO:          { syntax: 'SORT_RO key [BY pattern] [LIMIT offset count] [GET pattern] [ASC|DESC] [ALPHA]', desc: 'Read-only variant of SORT (Redis 7.0+)' },
  TOUCH:            { syntax: 'TOUCH key [key ...]',                           desc: 'Update the last access time of one or more keys' },
  TTL:              { syntax: 'TTL key',                                       desc: 'Get the time to live for a key in seconds' },
  TYPE:             { syntax: 'TYPE key',                                      desc: 'Determine the type stored at key' },
  UNLINK:           { syntax: 'UNLINK key [key ...]',                          desc: 'Delete a key asynchronously in another thread (non-blocking DEL)' },
  WAIT:             { syntax: 'WAIT numreplicas timeout',                      desc: 'Wait for the synchronous replication of all the write commands sent in the context of the current connection' },
  // Hash
  HDEL:             { syntax: 'HDEL key field [field ...]',                    desc: 'Delete one or more hash fields' },
  HEXISTS:          { syntax: 'HEXISTS key field',                             desc: 'Determine if a hash field exists' },
  HGET:             { syntax: 'HGET key field',                                desc: 'Get the value of a hash field' },
  HGETALL:          { syntax: 'HGETALL key',                                   desc: 'Get all the fields and values in a hash' },
  HINCRBY:          { syntax: 'HINCRBY key field increment',                   desc: 'Increment the integer value of a hash field' },
  HINCRBYFLOAT:     { syntax: 'HINCRBYFLOAT key field increment',              desc: 'Increment the float value of a hash field' },
  HKEYS:            { syntax: 'HKEYS key',                                     desc: 'Get all the fields in a hash' },
  HLEN:             { syntax: 'HLEN key',                                      desc: 'Get the number of fields in a hash' },
  HMGET:            { syntax: 'HMGET key field [field ...]',                   desc: 'Get the values of multiple hash fields' },
  HMSET:            { syntax: 'HMSET key field value [field value ...]',       desc: 'Set multiple hash fields (deprecated — use HSET)' },
  HRANDFIELD:       { syntax: 'HRANDFIELD key [count [WITHVALUES]]',           desc: 'Get one or more random fields from a hash (Redis 6.2+)' },
  HSCAN:            { syntax: 'HSCAN key cursor [MATCH pattern] [COUNT count]',desc: 'Incrementally iterate hash fields and associated values' },
  HSET:             { syntax: 'HSET key field value [field value ...]',        desc: 'Set one or more hash field values' },
  HSETNX:           { syntax: 'HSETNX key field value',                        desc: 'Set the value of a hash field, only if it does not exist' },
  HVALS:            { syntax: 'HVALS key',                                     desc: 'Get all the values in a hash' },
  // List
  BLMOVE:           { syntax: 'BLMOVE source destination LEFT|RIGHT LEFT|RIGHT timeout', desc: 'Pop from a list and push to another, blocking until available (Redis 6.2+)' },
  BLPOP:            { syntax: 'BLPOP key [key ...] timeout',                   desc: 'Remove and get the first element from a list, blocking until available' },
  BRPOP:            { syntax: 'BRPOP key [key ...] timeout',                   desc: 'Remove and get the last element from a list, blocking until available' },
  BRPOPLPUSH:       { syntax: 'BRPOPLPUSH source destination timeout',         desc: 'Pop from one list and push to another, blocking if source is empty (deprecated — use BLMOVE)' },
  LINDEX:           { syntax: 'LINDEX key index',                              desc: 'Get an element from a list by its index' },
  LINSERT:          { syntax: 'LINSERT key BEFORE|AFTER pivot element',        desc: 'Insert an element before or after another element in a list' },
  LLEN:             { syntax: 'LLEN key',                                      desc: 'Get the length of a list' },
  LMOVE:            { syntax: 'LMOVE source destination LEFT|RIGHT LEFT|RIGHT', desc: 'Pop an element from one list and push to another (Redis 6.2+)' },
  LMPOP:            { syntax: 'LMPOP numkeys key [key ...] LEFT|RIGHT [COUNT count]', desc: 'Pop elements from the first non-empty list (Redis 7.0+)' },
  LPOP:             { syntax: 'LPOP key [count]',                              desc: 'Remove and get the first elements in a list' },
  LPOS:             { syntax: 'LPOS key element [RANK rank] [COUNT count] [MAXLEN maxlen]', desc: 'Return the index of matching elements in a list (Redis 6.0.6+)' },
  LPUSH:            { syntax: 'LPUSH key element [element ...]',               desc: 'Prepend one or multiple elements to a list' },
  LPUSHX:           { syntax: 'LPUSHX key element [element ...]',              desc: 'Prepend elements to a list, only if the list exists' },
  LRANGE:           { syntax: 'LRANGE key start stop',                         desc: 'Get a range of elements from a list (0 -1 for all)' },
  LREM:             { syntax: 'LREM key count element',                        desc: 'Remove elements from a list (count>0 from head, count<0 from tail, count=0 all)' },
  LSET:             { syntax: 'LSET key index element',                        desc: 'Set the value of an element in a list by its index' },
  LTRIM:            { syntax: 'LTRIM key start stop',                          desc: 'Trim a list to the specified range' },
  RPOP:             { syntax: 'RPOP key [count]',                              desc: 'Remove and get the last elements in a list' },
  RPOPLPUSH:        { syntax: 'RPOPLPUSH source destination',                  desc: 'Remove the last element in a list and append it to another list (deprecated — use LMOVE)' },
  RPUSH:            { syntax: 'RPUSH key element [element ...]',               desc: 'Append one or multiple elements to a list' },
  RPUSHX:           { syntax: 'RPUSHX key element [element ...]',              desc: 'Append elements to a list, only if the list exists' },
  // Set
  SADD:             { syntax: 'SADD key member [member ...]',                  desc: 'Add one or more members to a set' },
  SCARD:            { syntax: 'SCARD key',                                     desc: 'Get the number of members in a set' },
  SDIFF:            { syntax: 'SDIFF key [key ...]',                           desc: 'Subtract multiple sets' },
  SDIFFSTORE:       { syntax: 'SDIFFSTORE destination key [key ...]',          desc: 'Subtract multiple sets and store the resulting set in a key' },
  SINTER:           { syntax: 'SINTER key [key ...]',                          desc: 'Intersect multiple sets' },
  SINTERCARD:       { syntax: 'SINTERCARD numkeys key [key ...] [LIMIT limit]',desc: 'Intersect multiple sets and return the cardinality (Redis 7.0+)' },
  SINTERSTORE:      { syntax: 'SINTERSTORE destination key [key ...]',         desc: 'Intersect multiple sets and store the resulting set in a key' },
  SISMEMBER:        { syntax: 'SISMEMBER key member',                          desc: 'Determine if a given value is a member of a set' },
  SMEMBERS:         { syntax: 'SMEMBERS key',                                  desc: 'Get all the members in a set' },
  SMISMEMBER:       { syntax: 'SMISMEMBER key member [member ...]',            desc: 'Returns the membership associated with the given elements for a set (Redis 6.2+)' },
  SMOVE:            { syntax: 'SMOVE source destination member',               desc: 'Move a member from one set to another' },
  SPOP:             { syntax: 'SPOP key [count]',                              desc: 'Remove and return one or multiple random members from a set' },
  SRANDMEMBER:      { syntax: 'SRANDMEMBER key [count]',                       desc: 'Get one or multiple random members from a set' },
  SREM:             { syntax: 'SREM key member [member ...]',                  desc: 'Remove one or more members from a set' },
  SUNION:           { syntax: 'SUNION key [key ...]',                          desc: 'Add multiple sets' },
  SUNIONSTORE:      { syntax: 'SUNIONSTORE destination key [key ...]',         desc: 'Add multiple sets and store the resulting set in a key' },
  // Sorted Set
  BZMPOP:           { syntax: 'BZMPOP timeout numkeys key [key ...] MIN|MAX [COUNT count]', desc: 'Remove and return members with lowest/highest scores from a sorted set or block (Redis 7.0+)' },
  BZPOPMAX:         { syntax: 'BZPOPMAX key [key ...] timeout',                desc: 'Remove and return the member with the highest score, blocking if empty (Redis 5.0+)' },
  BZPOPMIN:         { syntax: 'BZPOPMIN key [key ...] timeout',                desc: 'Remove and return the member with the lowest score, blocking if empty (Redis 5.0+)' },
  ZADD:             { syntax: 'ZADD key [NX|XX] [GT|LT] [CH] [INCR] score member [score member ...]', desc: 'Add one or more members to a sorted set, or update its score' },
  ZCARD:            { syntax: 'ZCARD key',                                     desc: 'Get the number of members in a sorted set' },
  ZCOUNT:           { syntax: 'ZCOUNT key min max',                            desc: 'Count the members in a sorted set with scores within the given values' },
  ZDIFF:            { syntax: 'ZDIFF numkeys key [key ...] [WITHSCORES]',      desc: 'Subtract multiple sorted sets (Redis 6.2+)' },
  ZDIFFSTORE:       { syntax: 'ZDIFFSTORE destination numkeys key [key ...]',  desc: 'Subtract multiple sorted sets and store the result (Redis 6.2+)' },
  ZINCRBY:          { syntax: 'ZINCRBY key increment member',                  desc: 'Increment the score of a member in a sorted set' },
  ZINTER:           { syntax: 'ZINTER numkeys key [key ...] [WEIGHTS w] [AGGREGATE SUM|MIN|MAX] [WITHSCORES]', desc: 'Intersect multiple sorted sets (Redis 6.2+)' },
  ZINTERCARD:       { syntax: 'ZINTERCARD numkeys key [key ...] [LIMIT limit]',desc: 'Intersect multiple sorted sets and return the cardinality (Redis 7.0+)' },
  ZINTERSTORE:      { syntax: 'ZINTERSTORE destination numkeys key [key ...] [WEIGHTS w] [AGGREGATE SUM|MIN|MAX]', desc: 'Intersect multiple sorted sets and store the result' },
  ZLEXCOUNT:        { syntax: 'ZLEXCOUNT key min max',                         desc: 'Count the number of members in a sorted set between a given lexicographical range' },
  ZMPOP:            { syntax: 'ZMPOP numkeys key [key ...] MIN|MAX [COUNT count]', desc: 'Remove and return members with lowest/highest scores from a sorted set (Redis 7.0+)' },
  ZMSCORE:          { syntax: 'ZMSCORE key member [member ...]',               desc: 'Get the scores associated with the given members in a sorted set (Redis 6.2+)' },
  ZPOPMAX:          { syntax: 'ZPOPMAX key [count]',                           desc: 'Remove and return members with the highest scores in a sorted set (Redis 5.0+)' },
  ZPOPMIN:          { syntax: 'ZPOPMIN key [count]',                           desc: 'Remove and return members with the lowest scores in a sorted set (Redis 5.0+)' },
  ZRANDMEMBER:      { syntax: 'ZRANDMEMBER key [count [WITHSCORES]]',          desc: 'Get one or more random elements from a sorted set (Redis 6.2+)' },
  ZRANGE:           { syntax: 'ZRANGE key min max [BYSCORE|BYLEX] [REV] [LIMIT offset count] [WITHSCORES]', desc: 'Return a range of members in a sorted set' },
  ZRANGEBYLEX:      { syntax: 'ZRANGEBYLEX key min max [LIMIT offset count]',  desc: 'Return a range of members in a sorted set, by lexicographical range' },
  ZRANGEBYSCORE:    { syntax: 'ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count]', desc: 'Return a range of members in a sorted set, by score' },
  ZRANGESTORE:      { syntax: 'ZRANGESTORE dst src min max [BYSCORE|BYLEX] [REV] [LIMIT offset count]', desc: 'Store a range from a sorted set into another key (Redis 6.2+)' },
  ZRANK:            { syntax: 'ZRANK key member [WITHSCORE]',                  desc: 'Determine the index of a member in a sorted set' },
  ZREM:             { syntax: 'ZREM key member [member ...]',                  desc: 'Remove one or more members from a sorted set' },
  ZREMRANGEBYLEX:   { syntax: 'ZREMRANGEBYLEX key min max',                    desc: 'Remove all members in a sorted set between the given lexicographical range' },
  ZREMRANGEBYRANK:  { syntax: 'ZREMRANGEBYRANK key start stop',                desc: 'Remove all members in a sorted set within the given indexes' },
  ZREMRANGEBYSCORE: { syntax: 'ZREMRANGEBYSCORE key min max',                  desc: 'Remove all members in a sorted set within the given scores' },
  ZREVRANGE:        { syntax: 'ZREVRANGE key start stop [WITHSCORES]',         desc: 'Return a range of members in a sorted set, by index, scores high to low (deprecated — use ZRANGE REV)' },
  ZREVRANGEBYLEX:   { syntax: 'ZREVRANGEBYLEX key max min [LIMIT offset count]',desc: 'Return a range of members in a sorted set, by lexicographical range, ordered from higher to lower strings' },
  ZREVRANGEBYSCORE: { syntax: 'ZREVRANGEBYSCORE key max min [WITHSCORES] [LIMIT offset count]', desc: 'Return a range of members in a sorted set, by score, high to low (deprecated — use ZRANGE REV BYSCORE)' },
  ZREVRANK:         { syntax: 'ZREVRANK key member [WITHSCORE]',               desc: 'Determine the index of a member in a sorted set, scores ordered high to low' },
  ZSCORE:           { syntax: 'ZSCORE key member',                             desc: 'Get the score associated with the given member in a sorted set' },
  ZUNION:           { syntax: 'ZUNION numkeys key [key ...] [WEIGHTS w] [AGGREGATE SUM|MIN|MAX] [WITHSCORES]', desc: 'Add multiple sorted sets (Redis 6.2+)' },
  ZUNIONSTORE:      { syntax: 'ZUNIONSTORE destination numkeys key [key ...] [WEIGHTS w] [AGGREGATE SUM|MIN|MAX]', desc: 'Add multiple sorted sets and store the resulting sorted set in a new key' },
  // HyperLogLog
  PFADD:            { syntax: 'PFADD key [element [element ...]]',             desc: 'Add the specified elements to the specified HyperLogLog' },
  PFCOUNT:          { syntax: 'PFCOUNT key [key ...]',                         desc: 'Return the approximated cardinality of the set(s) observed by the HyperLogLog' },
  PFMERGE:          { syntax: 'PFMERGE destkey sourcekey [sourcekey ...]',     desc: 'Merge multiple HyperLogLog values into a unique one' },
  // Geo
  GEOADD:           { syntax: 'GEOADD key [NX|XX] [CH] longitude latitude member [...]', desc: 'Add one or more geospatial items to a sorted set' },
  GEODIST:          { syntax: 'GEODIST key member1 member2 [M|KM|FT|MI]',     desc: 'Returns the distance between two members in the geospatial index' },
  GEOHASH:          { syntax: 'GEOHASH key member [member ...]',               desc: 'Return valid Geohash strings representing the position of one or more elements' },
  GEOPOS:           { syntax: 'GEOPOS key member [member ...]',                desc: 'Return longitude and latitude of members of a geospatial index' },
  GEORADIUS:        { syntax: 'GEORADIUS key longitude latitude radius M|KM|FT|MI [WITHCOORD] [WITHDIST] [COUNT count] [ASC|DESC]', desc: 'Query by radius from a point (deprecated — use GEOSEARCH)' },
  GEORADIUSBYMEMBER:{ syntax: 'GEORADIUSBYMEMBER key member radius M|KM|FT|MI [WITHCOORD] [WITHDIST] [COUNT count] [ASC|DESC]', desc: 'Query by radius from a member (deprecated — use GEOSEARCH)' },
  GEOSEARCH:        { syntax: 'GEOSEARCH key FROMMEMBER member|FROMLONLAT lon lat BYRADIUS radius M|KM|FT|MI|BYBOX w h M|KM|FT|MI [ASC|DESC] [COUNT count] [WITHCOORD] [WITHDIST]', desc: 'Query members in a geospatial index matching a radius or bounding box (Redis 6.2+)' },
  GEOSEARCHSTORE:   { syntax: 'GEOSEARCHSTORE destination source FROMMEMBER member|FROMLONLAT lon lat BYRADIUS r ...',desc: 'Like GEOSEARCH but stores the result (Redis 6.2+)' },
  // Streams
  XACK:             { syntax: 'XACK key group id [id ...]',                    desc: 'Mark pending stream messages as acknowledged in a consumer group' },
  XADD:             { syntax: 'XADD key [NOMKSTREAM] [MAXLEN|MINID [=|~] threshold] *|id field value [field value ...]', desc: 'Append a new entry to a stream' },
  XAUTOCLAIM:       { syntax: 'XAUTOCLAIM key group consumer min-idle-time start [COUNT count] [JUSTID]', desc: 'Transfer ownership of pending stream entries to another consumer (Redis 6.2+)' },
  XCLAIM:           { syntax: 'XCLAIM key group consumer min-idle-time id [id ...] [IDLE ms] [TIME unix-ms] [RETRYCOUNT count] [FORCE] [JUSTID]', desc: 'Changes the ownership of a pending message' },
  XDEL:             { syntax: 'XDEL key id [id ...]',                          desc: 'Removes specific entries from a stream' },
  XGROUP:           { syntax: 'XGROUP <subcommand> ...',                       desc: 'Manage consumer groups — use XGROUP CREATE, DESTROY, SETID, CREATECONSUMER, DELCONSUMER' },
  'XGROUP CREATE':  { syntax: 'XGROUP CREATE key groupname id|$ [MKSTREAM] [ENTRIESREAD entries-read]', desc: 'Create a consumer group for a stream' },
  'XGROUP CREATECONSUMER': { syntax: 'XGROUP CREATECONSUMER key groupname consumername', desc: 'Create a consumer in a consumer group' },
  'XGROUP DELCONSUMER':    { syntax: 'XGROUP DELCONSUMER key groupname consumername', desc: 'Delete a consumer from a consumer group' },
  'XGROUP DESTROY': { syntax: 'XGROUP DESTROY key groupname',                  desc: 'Destroy a consumer group' },
  'XGROUP SETID':   { syntax: 'XGROUP SETID key groupname id|$ [ENTRIESREAD entries-read]', desc: 'Set the last delivered ID for a group' },
  XINFO:            { syntax: 'XINFO <subcommand> ...',                        desc: 'Get information about streams — use XINFO STREAM, XINFO GROUPS, XINFO CONSUMERS' },
  'XINFO CONSUMERS':{ syntax: 'XINFO CONSUMERS key groupname',                 desc: 'Get information about consumers in a group' },
  'XINFO GROUPS':   { syntax: 'XINFO GROUPS key',                              desc: 'Get information about consumer groups in a stream' },
  'XINFO STREAM':   { syntax: 'XINFO STREAM key [FULL [COUNT count]]',         desc: 'Get information about a stream' },
  XLEN:             { syntax: 'XLEN key',                                      desc: 'Return the number of entries in a stream' },
  XPENDING:         { syntax: 'XPENDING key group [[IDLE min-idle-time] start end count [consumer]]', desc: 'Return information and entries from a stream consumer group pending entries list' },
  XRANGE:           { syntax: 'XRANGE key start end [COUNT count]',            desc: 'Return a range of elements in a stream, with IDs matching the specified range' },
  XREAD:            { syntax: 'XREAD [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]', desc: 'Return never seen elements in multiple streams, with IDs greater than the ones reported' },
  XREADGROUP:       { syntax: 'XREADGROUP GROUP group consumer [COUNT count] [BLOCK ms] [NOACK] STREAMS key [key ...] id [id ...]', desc: 'Return new or history pending messages from a stream via a consumer group' },
  XREVRANGE:        { syntax: 'XREVRANGE key end start [COUNT count]',         desc: 'Return a range of elements in a stream, with IDs in reverse order' },
  XTRIM:            { syntax: 'XTRIM key MAXLEN|MINID [=|~] threshold [LIMIT count]', desc: 'Trims the stream to a given number of items or minimum ID' },
  // Bit
  BITCOUNT:         { syntax: 'BITCOUNT key [start end [BYTE|BIT]]',           desc: 'Count set bits in a string' },
  BITFIELD:         { syntax: 'BITFIELD key [GET type offset] [SET type offset value] [INCRBY type offset increment] [OVERFLOW WRAP|SAT|FAIL]', desc: 'Perform arbitrary bitfield integer operations on strings' },
  BITFIELD_RO:      { syntax: 'BITFIELD_RO key GET type offset',               desc: 'Read-only variant of BITFIELD (Redis 6.0+)' },
  BITOP:            { syntax: 'BITOP AND|OR|XOR|NOT destkey key [key ...]',    desc: 'Perform bitwise operations between strings' },
  BITPOS:           { syntax: 'BITPOS key bit [start [end [BYTE|BIT]]]',       desc: 'Find first bit set or clear in a string' },
  // Scripting
  EVAL:             { syntax: 'EVAL script numkeys [key [key ...]] [arg [arg ...]]', desc: 'Execute a Lua script server side' },
  EVAL_RO:          { syntax: 'EVAL_RO script numkeys [key [key ...]] [arg [arg ...]]', desc: 'Read-only variant of EVAL (Redis 7.0+)' },
  EVALSHA:          { syntax: 'EVALSHA sha1 numkeys [key [key ...]] [arg [arg ...]]', desc: 'Execute a Lua script cached on the server using its SHA1 digest' },
  EVALSHA_RO:       { syntax: 'EVALSHA_RO sha1 numkeys [key [key ...]] [arg [arg ...]]', desc: 'Read-only variant of EVALSHA (Redis 7.0+)' },
  FCALL:            { syntax: 'FCALL function numkeys [key [key ...]] [arg [arg ...]]', desc: 'Invoke a library function (Redis 7.0+)' },
  FCALL_RO:         { syntax: 'FCALL_RO function numkeys [key [key ...]] [arg [arg ...]]', desc: 'Read-only variant of FCALL (Redis 7.0+)' },
  FUNCTION:         { syntax: 'FUNCTION <subcommand>',                         desc: 'Manage stored library functions — use FUNCTION LIST, LOAD, DELETE, STATS' },
  'FUNCTION DELETE':{ syntax: 'FUNCTION DELETE library-name',                  desc: 'Delete a library and all its functions (Redis 7.0+)' },
  'FUNCTION DUMP':  { syntax: 'FUNCTION DUMP',                                 desc: 'Return the serialized payload of all loaded libraries (Redis 7.0+)' },
  'FUNCTION LIST':  { syntax: 'FUNCTION LIST [LIBRARYNAME library-name-pattern] [WITHCODE]', desc: 'Return information about the functions and libraries (Redis 7.0+)' },
  'FUNCTION LOAD':  { syntax: 'FUNCTION LOAD [REPLACE] function-code',         desc: 'Create a library with its loaded functions (Redis 7.0+)' },
  'FUNCTION RESTORE':{ syntax: 'FUNCTION RESTORE serialized-value [FLUSH|APPEND|REPLACE]', desc: 'Restore libraries from the serialized payload of FUNCTION DUMP (Redis 7.0+)' },
  'FUNCTION STATS': { syntax: 'FUNCTION STATS',                                desc: 'Return information about the function execution (Redis 7.0+)' },
  SCRIPT:           { syntax: 'SCRIPT <subcommand>',                           desc: 'Manage the script cache — use SCRIPT EXISTS, FLUSH, KILL, LOAD' },
  'SCRIPT EXISTS':  { syntax: 'SCRIPT EXISTS sha1 [sha1 ...]',                 desc: 'Check existence of scripts in the script cache by their SHA1 digests' },
  'SCRIPT FLUSH':   { syntax: 'SCRIPT FLUSH [ASYNC|SYNC]',                     desc: 'Remove all the scripts from the script cache' },
  'SCRIPT KILL':    { syntax: 'SCRIPT KILL',                                   desc: 'Kill the script currently in execution' },
  'SCRIPT LOAD':    { syntax: 'SCRIPT LOAD script',                            desc: 'Load the specified Lua script into the script cache and return its SHA1 digest' },
  // Transaction
  DISCARD:          { syntax: 'DISCARD',                                       desc: 'Discard all commands issued after MULTI' },
  EXEC:             { syntax: 'EXEC',                                          desc: 'Execute all commands issued after MULTI' },
  MULTI:            { syntax: 'MULTI',                                         desc: 'Mark the start of a transaction block' },
  UNWATCH:          { syntax: 'UNWATCH',                                       desc: 'Forget about all watched keys' },
  WATCH:            { syntax: 'WATCH key [key ...]',                           desc: 'Watch the given keys to determine execution of the MULTI/EXEC block' },
  // Pub/Sub
  PSUBSCRIBE:       { syntax: 'PSUBSCRIBE pattern [pattern ...]',              desc: 'Listen for messages published to channels matching the given patterns' },
  PUBLISH:          { syntax: 'PUBLISH channel message',                       desc: 'Post a message to a channel' },
  PUBSUB:           { syntax: 'PUBSUB <subcommand>',                           desc: 'Inspect the state of the Pub/Sub subsystem' },
  'PUBSUB CHANNELS':{ syntax: 'PUBSUB CHANNELS [pattern]',                     desc: 'List active channels (optionally matching a pattern)' },
  'PUBSUB NUMPAT':  { syntax: 'PUBSUB NUMPAT',                                 desc: 'Return the number of pattern subscriptions' },
  'PUBSUB NUMSUB':  { syntax: 'PUBSUB NUMSUB [channel [channel ...]]',         desc: 'Return the number of subscribers for each channel' },
  PUNSUBSCRIBE:     { syntax: 'PUNSUBSCRIBE [pattern [pattern ...]]',          desc: 'Stop listening for messages posted to channels matching the given patterns' },
  SUBSCRIBE:        { syntax: 'SUBSCRIBE channel [channel ...]',               desc: 'Listen for messages published to the given channels' },
  UNSUBSCRIBE:      { syntax: 'UNSUBSCRIBE [channel [channel ...]]',           desc: 'Stop listening for messages posted to the given channels' },
  // ACL
  ACL:              { syntax: 'ACL <subcommand>',                              desc: 'Manage Redis ACL users — use ACL LIST, WHOAMI, CAT, GETUSER, SETUSER, DELUSER' },
  'ACL CAT':        { syntax: 'ACL CAT [categoryname]',                        desc: 'List the ACL categories or the commands inside a category' },
  'ACL DELUSER':    { syntax: 'ACL DELUSER username [username ...]',            desc: 'Remove the specified ACL users and invalidate their connections' },
  'ACL GENPASS':    { syntax: 'ACL GENPASS [bits]',                            desc: 'Generate a pseudorandom secure password (default 256 bits)' },
  'ACL GETUSER':    { syntax: 'ACL GETUSER username',                          desc: 'Get the rules for a specific ACL user' },
  'ACL LIST':       { syntax: 'ACL LIST',                                      desc: 'List the current ACL rules in ACL config file format' },
  'ACL LOG':        { syntax: 'ACL LOG [count|RESET]',                         desc: 'List latest events that were denied because of ACLs' },
  'ACL SAVE':       { syntax: 'ACL SAVE',                                      desc: 'Save the current ACL rules in the configured ACL file' },
  'ACL SETUSER':    { syntax: 'ACL SETUSER username [rule [rule ...]]',         desc: 'Create or modify an ACL user and associate rules' },
  'ACL USERS':      { syntax: 'ACL USERS',                                     desc: 'List the username of all the configured ACL rules' },
  'ACL WHOAMI':     { syntax: 'ACL WHOAMI',                                    desc: 'Return the name of the user associated to the current connection' },
  // Server
  AUTH:             { syntax: 'AUTH [username] password',                      desc: 'Authenticate to the server' },
  BGREWRITEAOF:     { syntax: 'BGREWRITEAOF',                                  desc: 'Asynchronously rewrite the append-only file' },
  BGSAVE:           { syntax: 'BGSAVE [SCHEDULE]',                             desc: 'Asynchronously save the dataset to disk' },
  CLIENT:           { syntax: 'CLIENT <subcommand>',                           desc: 'Manage client connections — use CLIENT LIST, ID, GETNAME, SETNAME, KILL, INFO' },
  'CLIENT GETNAME': { syntax: 'CLIENT GETNAME',                                desc: 'Get the current connection name' },
  'CLIENT ID':      { syntax: 'CLIENT ID',                                     desc: 'Get the ID of the current client connection' },
  'CLIENT INFO':    { syntax: 'CLIENT INFO',                                   desc: 'Return information about the current client connection (Redis 7.2+)' },
  'CLIENT KILL':    { syntax: 'CLIENT KILL [id client-id] [addr ip:port] [user username] [skipme yes/no]', desc: 'Kill the connection of a client' },
  'CLIENT LIST':    { syntax: 'CLIENT LIST [TYPE normal|master|replica|pubsub] [ID client-id ...]', desc: 'Get the list of all connected clients' },
  'CLIENT PAUSE':   { syntax: 'CLIENT PAUSE timeout [WRITE|ALL]',              desc: 'Stop processing commands from clients for the specified duration' },
  'CLIENT SETNAME': { syntax: 'CLIENT SETNAME connection-name',                desc: 'Set the current connection name' },
  'CLIENT UNPAUSE': { syntax: 'CLIENT UNPAUSE',                                desc: 'Resume processing of clients that were paused' },
  CLUSTER:          { syntax: 'CLUSTER <subcommand>',                          desc: 'Manage Redis Cluster — use CLUSTER INFO, NODES, MYID, KEYSLOT' },
  'CLUSTER INFO':   { syntax: 'CLUSTER INFO',                                  desc: 'Provides info about Redis Cluster node state' },
  'CLUSTER KEYSLOT':{ syntax: 'CLUSTER KEYSLOT key',                           desc: 'Return the hash slot for the key' },
  'CLUSTER MYID':   { syntax: 'CLUSTER MYID',                                  desc: 'Return the node id of the current node' },
  'CLUSTER NODES':  { syntax: 'CLUSTER NODES',                                 desc: 'Get Cluster config for the node' },
  'CLUSTER SHARDS': { syntax: 'CLUSTER SHARDS',                                desc: 'Get array of Cluster slot to node mappings per shard (Redis 7.0+)' },
  'CLUSTER SLOTS':  { syntax: 'CLUSTER SLOTS',                                 desc: 'Get array of Cluster slot to node mappings (deprecated — use CLUSTER SHARDS)' },
  COMMAND:          { syntax: 'COMMAND',                                       desc: 'Get array of Redis command details' },
  'COMMAND COUNT':  { syntax: 'COMMAND COUNT',                                 desc: 'Get total number of Redis commands' },
  'COMMAND DOCS':   { syntax: 'COMMAND DOCS [command-name [command-name ...]]',desc: 'Return documentation for given commands (Redis 7.0+)' },
  'COMMAND GETKEYS':{ syntax: 'COMMAND GETKEYS command [arg [arg ...]]',       desc: 'Extract keys given a full Redis command' },
  'COMMAND INFO':   { syntax: 'COMMAND INFO command-name [command-name ...]',  desc: 'Get array of specific Redis command details' },
  'COMMAND LIST':   { syntax: 'COMMAND LIST [FILTERBY MODULE module|ACLCAT cat|PATTERN pattern]', desc: 'Return a list of command names (Redis 7.0+)' },
  CONFIG:           { syntax: 'CONFIG <subcommand>',                           desc: 'Configure Redis server — use CONFIG GET, SET, RESETSTAT, REWRITE' },
  'CONFIG GET':     { syntax: 'CONFIG GET parameter [parameter ...]',          desc: 'Get the value of config parameter(s). Use * for all (e.g. CONFIG GET maxmemory*)' },
  'CONFIG RESETSTAT':{ syntax: 'CONFIG RESETSTAT',                             desc: 'Reset the stats returned by INFO' },
  'CONFIG REWRITE': { syntax: 'CONFIG REWRITE',                                desc: 'Rewrite the redis.conf file with the current in-memory configuration' },
  'CONFIG SET':     { syntax: 'CONFIG SET parameter value [parameter value ...]', desc: 'Set one or more configuration parameters (e.g. CONFIG SET maxmemory 100mb)' },
  DBSIZE:           { syntax: 'DBSIZE',                                        desc: 'Return the number of keys in the selected database' },
  DEBUG:            { syntax: 'DEBUG <subcommand>',                            desc: 'Debugging commands — use DEBUG OBJECT, DEBUG SLEEP' },
  'DEBUG OBJECT':   { syntax: 'DEBUG OBJECT key',                              desc: 'Get debugging information about a key (encoding, serialized length, etc.)' },
  'DEBUG SLEEP':    { syntax: 'DEBUG SLEEP seconds',                           desc: 'Make the server sleep for N seconds' },
  ECHO:             { syntax: 'ECHO message',                                  desc: 'Echo the given string' },
  FAILOVER:         { syntax: 'FAILOVER [TO host port [FORCE]] [ABORT] [TIMEOUT ms]', desc: 'Start a coordinated failover to a replica (Redis 6.2+)' },
  FLUSHALL:         { syntax: 'FLUSHALL [ASYNC|SYNC]',                         desc: 'Remove all keys from all databases' },
  FLUSHDB:          { syntax: 'FLUSHDB [ASYNC|SYNC]',                          desc: 'Remove all keys from the current database' },
  HELLO:            { syntax: 'HELLO [protover [AUTH username password] [SETNAME clientname]]', desc: 'Handshake with Redis — switch to RESP3 or reset connection (Redis 6.0+)' },
  INFO:             { syntax: 'INFO [section]',                                desc: 'Get server information. Sections: server, clients, memory, persistence, stats, replication, cpu, keyspace, all' },
  LASTSAVE:         { syntax: 'LASTSAVE',                                      desc: 'Get the UNIX time stamp of the last successful save to disk' },
  LATENCY:          { syntax: 'LATENCY <subcommand>',                          desc: 'Analyze Redis latency — use LATENCY LATEST, HISTORY, RESET' },
  'LATENCY HISTORY':{ syntax: 'LATENCY HISTORY event-name',                    desc: 'Return latency history for a given event' },
  'LATENCY LATEST': { syntax: 'LATENCY LATEST',                                desc: 'Return the latest latency samples for all events' },
  'LATENCY RESET':  { syntax: 'LATENCY RESET [event-name [event-name ...]]',   desc: 'Reset latency data for one or more events' },
  LOLWUT:           { syntax: 'LOLWUT [VERSION version]',                      desc: 'Display some computer art and the Redis version' },
  MEMORY:           { syntax: 'MEMORY <subcommand>',                           desc: 'Analyze memory usage — use MEMORY USAGE, STATS, DOCTOR, MALLOC-STATS' },
  'MEMORY DOCTOR':  { syntax: 'MEMORY DOCTOR',                                 desc: 'Return memory problems report with suggestions' },
  'MEMORY MALLOC-STATS':{ syntax: 'MEMORY MALLOC-STATS',                       desc: 'Return detailed statistics from the allocator' },
  'MEMORY PURGE':   { syntax: 'MEMORY PURGE',                                  desc: 'Ask the allocator to release memory back to the OS' },
  'MEMORY STATS':   { syntax: 'MEMORY STATS',                                  desc: 'Return memory usage details broken down by category' },
  'MEMORY USAGE':   { syntax: 'MEMORY USAGE key [SAMPLES count]',              desc: 'Estimate the memory usage of a key in bytes' },
  MONITOR:          { syntax: 'MONITOR',                                       desc: 'Stream back every command processed by the Redis server (WARNING: use sparingly)' },
  MODULE:           { syntax: 'MODULE <subcommand>',                           desc: 'Manage Redis modules — use MODULE LIST, LOAD, UNLOAD' },
  'MODULE LIST':    { syntax: 'MODULE LIST',                                   desc: 'List all modules loaded in the server' },
  'MODULE LOAD':    { syntax: 'MODULE LOAD path [arg [arg ...]]',              desc: 'Load a module from a dynamic library path' },
  'MODULE UNLOAD':  { syntax: 'MODULE UNLOAD name',                            desc: 'Unload a module' },
  PING:             { syntax: 'PING [message]',                                desc: 'Ping the server — returns PONG or echoes message' },
  QUIT:             { syntax: 'QUIT',                                          desc: 'Close the connection' },
  REPLICAOF:        { syntax: 'REPLICAOF host port',                           desc: 'Make the server a replica of another instance, or promote it as master (use REPLICAOF NO ONE)' },
  RESET:            { syntax: 'RESET',                                         desc: 'Reset the connection — discards all state (subscriptions, MULTI, etc.) (Redis 6.2+)' },
  ROLE:             { syntax: 'ROLE',                                          desc: 'Return the role of the server (master, slave, sentinel) and replication info' },
  SAVE:             { syntax: 'SAVE',                                          desc: 'Synchronously save the dataset to disk (blocks server — prefer BGSAVE)' },
  SELECT:           { syntax: 'SELECT index',                                  desc: 'Change the selected database for the current connection (0–15)' },
  SHUTDOWN:         { syntax: 'SHUTDOWN [NOSAVE|SAVE] [NOW] [FORCE] [ABORT]',  desc: 'Synchronously save the dataset and then shut down the server' },
  SLAVEOF:          { syntax: 'SLAVEOF host port',                             desc: 'Make the server a replica (deprecated — use REPLICAOF)' },
  SLOWLOG:          { syntax: 'SLOWLOG <subcommand>',                          desc: 'Manage the Redis slow queries log — use SLOWLOG GET, LEN, RESET' },
  'SLOWLOG GET':    { syntax: 'SLOWLOG GET [count]',                           desc: 'Return the latest slow log entries. Enable with: CONFIG SET slowlog-log-slower-than 0' },
  'SLOWLOG LEN':    { syntax: 'SLOWLOG LEN',                                   desc: 'Return the number of entries in the slow log' },
  'SLOWLOG RESET':  { syntax: 'SLOWLOG RESET',                                 desc: 'Clear all entries from the slow log' },
  SWAPDB:           { syntax: 'SWAPDB index1 index2',                          desc: 'Swaps two Redis databases' },
  TIME:             { syntax: 'TIME',                                          desc: 'Return the current server time as a two items list: Unix timestamp and microseconds' },
}

const DANGEROUS = new Set(['FLUSHDB', 'FLUSHALL', 'SHUTDOWN', 'DEBUG SLEEP', 'SCRIPT FLUSH'])
const STATUS_RESPONSES = new Set(['OK', 'PONG', 'QUEUED'])
const PAGINATION_LIMIT = 50

// --- Output rendering helpers ---

function renderInlineValue(val) {
  if (val === '(nil)') return <span className="cli-nil">(nil)</span>
  if (val.startsWith('(integer) ')) return <span className="cli-integer">{val}</span>
  if (val.startsWith('"')) return <span className="cli-string">{val}</span>
  return <span>{val}</span>
}

function renderLine(line) {
  if (!line) return <span>&nbsp;</span>

  line = line.trim()
  const arrayMatch = line.match(/^(\d+\) )([\s\S]*)/)
  if (arrayMatch) {
    return (
      <>
        <span className="cli-index">{arrayMatch[1]}</span>
        {renderInlineValue(arrayMatch[2])}
      </>
    )
  }

  if (line.startsWith('# ')) {
    return <span className="cli-section">{line}</span>
  }

  const kvMatch = line.match(/^([a-z][a-z0-9_]*):(.*)?$/)
  if (kvMatch) {
    return (
      <>
        <span className="cli-kv-key">{kvMatch[1]}</span>
        <span className="cli-kv-sep">:</span>
        <span className="cli-kv-val">{kvMatch[2] ?? ''}</span>
      </>
    )
  }

  return <span>{line}</span>
}

function renderMultiLine(lines) {
  const filtered = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
  return (
    <div className="cli-response cli-multiline">
      {filtered.map((line, i) => (
        <div key={i} className="cli-ml-line">{renderLine(line)}</div>
      ))}
    </div>
  )
}

function renderOutput(output) {
  if (output == null) return null

  if (output === '(nil)') {
    return <div className="cli-response"><span className="cli-nil">(nil)</span></div>
  }

  if (output === '(empty array)' || output === '(empty list or set)') {
    return <div className="cli-response"><span className="cli-nil">{output}</span></div>
  }

  if (STATUS_RESPONSES.has(output)) {
    return <div className="cli-response"><span className="cli-status">{output}</span></div>
  }

  if (output.startsWith('(integer) ')) {
    return <div className="cli-response"><span className="cli-integer">{output}</span></div>
  }

  if (output.startsWith('"') && output.endsWith('"')) {
    const inner = output.slice(1, -1)

    if (inner.includes('\n')) {
      return renderMultiLine(inner.split('\n'))
    }

    try {
      const parsed = JSON.parse(inner)
      if (typeof parsed === 'object' && parsed !== null) {
        return <pre className="cli-response cli-json">{JSON.stringify(parsed, null, 2)}</pre>
      }
    } catch { /* ignore */ }

    return <div className="cli-response"><span className="cli-string">{output}</span></div>
  }

  if (output.includes('\n')) {
    return renderMultiLine(output.split('\n'))
  }

  return <pre className="cli-response">{output}</pre>
}

// ---

export default function CliConsole({ connection, onLog, onAdd, onClose, compact }) {
  const [entries, setEntries] = useState([])
  const [input, setInput] = useState('')
  const [cmdHistory, setCmdHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggIdx, setSuggIdx] = useState(-1)
  const [pendingDangerous, setPendingDangerous] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyTab, setHistoryTab] = useState('history')
  const [favorites, setFavorites] = useState([])

  const outputRef = useRef(null)
  const inputRef = useRef(null)
  const gutterRef = useRef(null)
  const prevConnRef = useRef({ id: connection.id, db: connection.db ?? 0 })
  const isMouseDownInOutput = useRef(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('redivue_cli_history')
      if (saved) setCmdHistory(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (cmdHistory.length === 0) return
    try {
      localStorage.setItem('redivue_cli_history', JSON.stringify(cmdHistory))
    } catch { /* ignore */ }
  }, [cmdHistory])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('redivue_cli_favorites')
      if (saved) setFavorites(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('redivue_cli_favorites', JSON.stringify(favorites))
    } catch { /* ignore */ }
  }, [favorites])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
    inputRef.current?.focus()
  }, [entries])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  useEffect(() => {
    const cur = connection.db ?? 0
    if (prevConnRef.current.id === connection.id && prevConnRef.current.db !== cur) {
      setEntries(prev => [...prev, { id: Date.now(), systemMessage: `Switched to db${cur}` }])
    }
    prevConnRef.current = { id: connection.id, db: cur }
  }, [connection.id, connection.db])

  const connBody = buildConnBody(connection)

  const runCommand = useCallback(async (command) => {
    const trimmed = command.trim()
    if (!trimmed) return

    const normalized = trimmed.replace(/\n+/g, ' ')
    const firstWord = normalized.split(/\s+/)[0].toUpperCase()

    if (DANGEROUS.has(firstWord) && pendingDangerous !== normalized) {
      setPendingDangerous(normalized)
      setEntries(prev => [...prev, {
        id: Date.now(),
        command: normalized,
        output: null,
        warning: `⚠ This will ${firstWord === 'FLUSHDB' ? 'flush current database' : 'flush ALL databases'}. Run again to confirm.`,
        time: null,
        dangerous: true,
      }])
      return
    }

    setPendingDangerous(null)
    setLoading(true)
    const entryId = Date.now()
    const isDangerous = DANGEROUS.has(firstWord)
    setEntries(prev => [...prev, { id: entryId, command: normalized, output: null, error: null, time: null, loading: true, dangerous: isDangerous, expanded: false }])

    try {
      const res = await fetch(`/api/redis/${connection.id}/cli`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, command: normalized }),
      })
      const data = await res.json()
      setEntries(prev => prev.map(e =>
        e.id === entryId
          ? { ...e, output: data.output ?? null, error: data.error ?? null, time: data.executionTime, loading: false }
          : e
      ))
      if (!data.error) {
        const summary = data.output ? String(data.output).split('\n')[0].slice(0, 60) : 'OK'
        onLog?.({ label: `CLI: ${normalized}`, detail: `→ ${summary}` })
      }
    } catch (err) {
      setEntries(prev => prev.map(e =>
        e.id === entryId
          ? { ...e, error: err.message, loading: false }
          : e
      ))
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [connection, pendingDangerous])

  const handleSubmit = () => {
    const cmd = input.trim()
    if (!cmd) return
    setCmdHistory(prev => [cmd, ...prev.filter(c => c !== cmd)].slice(0, 200))
    setHistIdx(-1)
    setInput('')
    setSuggestions([])
    setSuggIdx(-1)
    runCommand(cmd)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSuggIdx(i => i >= suggestions.length - 1 ? -1 : i + 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggIdx(i => i === -1 ? suggestions.length - 1 : i - 1)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && suggIdx >= 0)) {
        e.preventDefault()
        const chosen = suggestions[suggIdx >= 0 ? suggIdx : 0]
        setInput(chosen + ' ')
        setSuggestions([])
        setSuggIdx(-1)
        return
      }
      if (e.key === 'Escape') {
        setSuggestions([])
        setSuggIdx(-1)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
      return
    }

    const isMultiLine = input.includes('\n')

    if (e.key === 'ArrowUp' && !isMultiLine) {
      e.preventDefault()
      setHistIdx(i => {
        const next = Math.min(i + 1, cmdHistory.length - 1)
        if (cmdHistory[next] !== undefined) setInput(cmdHistory[next])
        return next
      })
      return
    }

    if (e.key === 'ArrowDown' && !isMultiLine) {
      e.preventDefault()
      setHistIdx(i => {
        const next = i - 1
        if (next < 0) { setInput(''); return -1 }
        if (cmdHistory[next] !== undefined) setInput(cmdHistory[next])
        return next
      })
      return
    }

    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setEntries([])
      return
    }
  }

  const handleInputChange = (e) => {
    const val = e.target.value
    setInput(val)
    setHistIdx(-1)

    if (!val.includes('\n') && val.split(/\s+/).filter(Boolean).length <= 2 && val.length > 0) {
      const upper = val.toUpperCase()
      const matches = REDIS_COMMANDS.filter(c => c.startsWith(upper))
      setSuggestions(matches.slice(0, 8))
      setSuggIdx(-1)
    } else {
      setSuggestions([])
      setSuggIdx(-1)
    }
  }

  const handleClear = () => setEntries([])

  const handleCopyAll = () => {
    const text = entries.map(e => {
      let out = `> ${e.command}`
      if (e.output != null) out += `\n${e.output}`
      if (e.error) out += `\n(error) ${e.error}`
      return out
    }).join('\n\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  const handleCopyEntry = (entry, ev) => {
    ev.stopPropagation()
    let text = `> ${entry.command}`
    if (entry.output != null) text += `\n${entry.output}`
    if (entry.error) text += `\n(error) ${entry.error}`
    navigator.clipboard.writeText(text).catch(() => {})
  }

  const toggleExpand = (id) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, expanded: !e.expanded } : e))
  }

  const toggleFavorite = (cmd, e) => {
    e.stopPropagation()
    setFavorites(prev =>
      prev.includes(cmd) ? prev.filter(f => f !== cmd) : [cmd, ...prev]
    )
  }

  const syncGutterScroll = () => {
    if (gutterRef.current && inputRef.current) {
      gutterRef.current.scrollTop = inputRef.current.scrollTop
    }
  }

  const helpTip = (() => {
    const parts = input.trimStart().split(/\s+/)
    const twoWord = parts.slice(0, 2).join(' ').toUpperCase()
    const oneWord = parts[0]?.toUpperCase()
    const key = (twoWord && REDIS_HELP[twoWord]) ? twoWord : oneWord
    if (key && REDIS_HELP[key] && suggestions.length === 0) {
      return REDIS_HELP[key]
    }
    return null
  })()

  const focusInput = () => {
    if (window.getSelection()?.toString().length > 0) return
    inputRef.current?.focus()
  }

  const handleInputBlur = () => {
    requestAnimationFrame(() => {
      if (!document.hasFocus()) return
      if (isMouseDownInOutput.current) return
      if (window.getSelection()?.toString().length > 0) return
      const active = document.activeElement
      if (!active || active === document.body) {
        inputRef.current?.focus()
      }
    })
  }

  return (
    <div className="cli-console" onClick={focusInput}>
      <div className="cli-toolbar">
        <span className="cli-title">Redis CLI — {connection.name || `${connection.host}:${connection.port}`} · db{connection.db ?? 0}</span>
        <div className="cli-toolbar-actions">
          {!compact && <span className="cli-hint">↑↓ history · Tab autocomplete · Shift+Enter newline · Ctrl+L clear</span>}
          <button
            className={`cli-btn cli-btn-history${showHistory ? ' cli-btn-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowHistory(v => !v); setHistorySearch('') }}
          >History</button>
          <button className="cli-btn" onClick={handleCopyAll} title="Copy all output">Copy all</button>
          <button className="cli-btn cli-btn-danger" onClick={handleClear} title="Clear console">Clear</button>
          {onAdd && (
            <button className="cli-btn cli-btn-add" onClick={(e) => { e.stopPropagation(); onAdd() }} title="Add CLI pane">Add New Pane</button>
          )}
          {onClose && (
            <button className="cli-btn cli-btn-close" onClick={(e) => { e.stopPropagation(); onClose() }} title="Close this pane">✕</button>
          )}
        </div>
      </div>

      <div
        className="cli-output"
        ref={outputRef}
        onMouseDown={() => { isMouseDownInOutput.current = true }}
        onMouseUp={() => { isMouseDownInOutput.current = false }}
      >
        {entries.length === 0 && (
          <div className="cli-welcome">
            <div className="cli-welcome-line">Redis CLI Console ready.</div>
            <div className="cli-welcome-line dim">Type a command and press Enter. Shift+Enter for new line. ↑↓ for history.</div>
          </div>
        )}
        {entries.map(entry => (
          <div key={entry.id} className="cli-entry">
            {entry.systemMessage ? (
              <div style={{ color: '#f0883e', fontStyle: 'italic', fontSize: '0.85em', padding: '2px 0 2px 10px', borderLeft: '3px solid #f0883e', margin: '4px 0' }}>
                ⟳ {entry.systemMessage}
              </div>
            ) : (
              <>
                <div className="cli-command-line">
                  <span className="cli-prompt">&gt;</span>
                  <span className={`cli-cmd-text${entry.dangerous ? ' cli-cmd-dangerous' : ''}`}>
                    {entry.command}
                  </span>
                  <button
                    className="cli-entry-copy"
                    onClick={(ev) => handleCopyEntry(entry, ev)}
                    title="Copy this entry"
                  >⎘</button>
                </div>
                {entry.warning && (
                  <div className="cli-warning">{entry.warning}</div>
                )}
                {entry.loading && (
                  <div className="cli-loading-dots">···</div>
                )}
                {!entry.loading && entry.output != null && (() => {
                  const lines = entry.output.split('\n')
                  const totalLines = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
                  const needsPagination = totalLines > PAGINATION_LIMIT
                  const visibleOutput = needsPagination && !entry.expanded
                    ? lines.slice(0, PAGINATION_LIMIT).join('\n')
                    : entry.output
                  const hiddenCount = totalLines - PAGINATION_LIMIT
                  return (
                    <div className="cli-output-value">
                      {renderOutput(visibleOutput)}
                      {needsPagination && !entry.expanded && (
                        <button className="cli-pagination-btn" onClick={() => toggleExpand(entry.id)}>
                          ▼ Show {hiddenCount} more line{hiddenCount !== 1 ? 's' : ''}
                        </button>
                      )}
                      {needsPagination && entry.expanded && (
                        <button className="cli-pagination-btn" onClick={() => toggleExpand(entry.id)}>
                          ▲ Collapse
                        </button>
                      )}
                      {entry.output.length > 500 && (
                        <span className="cli-size">{entry.output.length} chars · {totalLines} lines</span>
                      )}
                    </div>
                  )
                })()}
                {!entry.loading && entry.error && (
                  <div className="cli-error-line">(error) {entry.error}</div>
                )}
                {!entry.loading && entry.time != null && (
                  <div className="cli-time">{entry.time}ms</div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {showHistory && (() => {
        const filtered = historySearch
          ? cmdHistory.filter(c => c.toLowerCase().includes(historySearch.toLowerCase()))
          : cmdHistory
        const list = historyTab === 'favorites' ? favorites : filtered
        const selectCmd = (cmd) => {
          setInput(cmd)
          setShowHistory(false)
          setHistorySearch('')
          inputRef.current?.focus()
        }
        return (
          <div className="cli-history-panel" onClick={e => e.stopPropagation()}>
            <div className="cli-history-header">
              <div className="cli-history-tabs">
                <button className={`cli-tab${historyTab === 'history' ? ' active' : ''}`} onClick={() => setHistoryTab('history')}>
                  History {cmdHistory.length > 0 && <span className="cli-tab-count">{cmdHistory.length}</span>}
                </button>
                <button className={`cli-tab${historyTab === 'favorites' ? ' active' : ''}`} onClick={() => setHistoryTab('favorites')}>
                  Favorites {favorites.length > 0 && <span className="cli-tab-count">{favorites.length}</span>}
                </button>
              </div>
              {historyTab === 'history' && (
                <input
                  className="cli-history-search"
                  placeholder="Filter..."
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Escape') setShowHistory(false) }}
                />
              )}
              {historyTab === 'history' && (
                <button className="cli-btn" onClick={() => { setCmdHistory([]); setShowHistory(false) }}>Clear</button>
              )}
              {historyTab === 'favorites' && favorites.length > 0 && (
                <button className="cli-btn cli-btn-danger" onClick={() => setFavorites([])}>Clear</button>
              )}
            </div>
            <div className="cli-history-list">
              {list.length === 0 && (
                <div className="cli-history-empty">
                  {historyTab === 'favorites' ? 'No favorites yet — click ★ on any command' : 'No matching commands'}
                </div>
              )}
              {list.map((cmd, i) => (
                <div key={i} className="cli-history-item" onClick={() => selectCmd(cmd)}>
                  <button
                    className={`cli-fav-btn${favorites.includes(cmd) ? ' active' : ''}`}
                    onClick={(e) => toggleFavorite(cmd, e)}
                    title={favorites.includes(cmd) ? 'Remove from favorites' : 'Add to favorites'}
                  >★</button>
                  <span className="cli-history-cmd">{cmd}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {helpTip && (
        <div className="cli-cmd-hint" onClick={e => e.stopPropagation()}>
          <span className="cli-cmd-hint-syntax">{helpTip.syntax}</span>
          <span className="cli-cmd-hint-desc">{helpTip.desc}</span>
        </div>
      )}

      {(() => {
        const trimmed = input.trimStart()
        const upper = trimmed.toUpperCase()
        const isWriteCmd = upper.startsWith('SET ') || upper.startsWith('HSET ') || upper.startsWith('LPUSH ') || upper.startsWith('RPUSH ') || upper.startsWith('SADD ') || upper.startsWith('ZADD ')
        if (!isWriteCmd) return null
        // check if any unquoted token starts with { or [
        const tokens = trimmed.split(/\s+/)
        const hasUnquotedJson = tokens.slice(2).some(t => (t.startsWith('{') || t.startsWith('[')) && !t.startsWith("'"))
        if (!hasUnquotedJson) return null
        return (
          <div className="cli-json-hint" onClick={e => e.stopPropagation()}>
            <span className="cli-json-hint-icon">&#9432;</span>
            <span>Wrap JSON values in single quotes: <code>SET key &#39;{"{"}&quot;json&quot;:&quot;value&quot;{"}"}&#39;</code> — unquoted double quotes are stripped by the tokenizer.</span>
          </div>
        )
      })()}

      <div className="cli-input-area">
        <span className="cli-prompt-fixed">&gt;</span>
        <div className="cli-input-wrapper">
          {input.includes('\n') && (
            <div className="cli-line-numbers" ref={gutterRef}>
              {input.split('\n').map((_, i) => (
                <span key={i} className="cli-line-num">{i + 1}</span>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            className="cli-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleInputBlur}
            onScroll={syncGutterScroll}
            placeholder="Type a Redis command..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            rows={1}
          />
          {suggestions.length > 0 && (
            <ul className="cli-suggestions">
              {suggestions.map((s, i) => (
                <li
                  key={s}
                  className={`cli-suggestion-item ${i === suggIdx ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setInput(s + ' ')
                    setSuggestions([])
                    setSuggIdx(-1)
                    inputRef.current?.focus()
                  }}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          className="cli-run-btn"
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
        >
          Run
        </button>
      </div>
    </div>
  )
}
