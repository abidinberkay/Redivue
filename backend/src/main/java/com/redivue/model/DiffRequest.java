package com.redivue.model;

import lombok.Data;

@Data
public class DiffRequest {
    private String key;
    private RedisConnection left;
    private RedisConnection right;
}
