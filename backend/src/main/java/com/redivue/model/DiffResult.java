package com.redivue.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiffResult {
    private KeyValueResult left;
    private KeyValueResult right;
    private String leftError;
    private String rightError;
}
