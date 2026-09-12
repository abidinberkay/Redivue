package com.redivue.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KeyScanResult {
    private String nextCursor;
    private List<KeyInfo> keys;
    private boolean done;
}
