package com.redivue.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class HostHeaderFilterTest {

    private static int status(String allowedHosts, String serverName) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/redis/1/cli");
        req.setServerName(serverName);
        MockHttpServletResponse res = new MockHttpServletResponse();
        new HostHeaderFilter(allowedHosts).doFilter(req, res, new MockFilterChain());
        return res.getStatus();
    }

    @Test
    void loopbackNamesAlwaysAllowed() throws Exception {
        assertThat(status("", "localhost")).isEqualTo(200);
        assertThat(status("", "LOCALHOST")).isEqualTo(200);
        assertThat(status("", "127.0.0.1")).isEqualTo(200);
        assertThat(status("", "[::1]")).isEqualTo(200);
    }

    @Test
    void foreignHostRejectedByDefault() throws Exception {
        // What a DNS-rebinding page looks like: attacker's name, resolving to 127.0.0.1
        assertThat(status("", "attacker.example")).isEqualTo(403);
        assertThat(status("", "192.168.1.10")).isEqualTo(403);
    }

    @Test
    void configuredHostsAllowedIgnoringCaseSpacesAndPorts() throws Exception {
        String cfg = " Redivue.Internal.Example:443 , 192.168.1.10";
        assertThat(status(cfg, "redivue.internal.example")).isEqualTo(200);
        assertThat(status(cfg, "192.168.1.10")).isEqualTo(200);
        assertThat(status(cfg, "attacker.example")).isEqualTo(403);
    }

    @Test
    void wildcardDisablesCheck() throws Exception {
        assertThat(status("*", "attacker.example")).isEqualTo(200);
    }

    @Test
    void normalizeHandlesPortsAndIpv6() {
        assertThat(HostHeaderFilter.normalize("Example.com:8080")).isEqualTo("example.com");
        assertThat(HostHeaderFilter.normalize("[::1]:8080")).isEqualTo("::1");
        assertThat(HostHeaderFilter.normalize("::1")).isEqualTo("::1");
        assertThat(HostHeaderFilter.normalize(null)).isEmpty();
    }
}
