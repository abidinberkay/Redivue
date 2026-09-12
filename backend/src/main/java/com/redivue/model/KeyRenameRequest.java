package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class KeyRenameRequest extends RedisConnection {
    private String key;
    private String newKey;
}
