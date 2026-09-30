package com.redivue.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * DNS-rebinding guard. Redivue has no login, so a malicious page that rebinds its own domain to
 * 127.0.0.1 would otherwise be same-origin with a local Redivue and could drive the API - e.g. to
 * reach password-less Redis instances on the user's network. The browser still sends the
 * attacker's hostname in the Host header, so only known hostnames are let through.
 *
 * Loopback names are always allowed. Anything else (a server's domain or LAN IP) must be listed
 * in REDIVUE_ALLOWED_HOSTS (comma-separated, ports ignored); "*" disables the check.
 */
@Slf4j
@Component
public class HostHeaderFilter extends OncePerRequestFilter {

    private static final Set<String> LOOPBACK = Set.of("localhost", "127.0.0.1", "::1");

    private final Set<String> allowed;
    private final boolean allowAll;

    public HostHeaderFilter(@Value("${redivue.allowed-hosts:}") String allowedHosts) {
        this.allowed = Arrays.stream(allowedHosts.split(","))
                .map(HostHeaderFilter::normalize)
                .filter(h -> !h.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
        this.allowAll = allowed.contains("*");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String host = normalize(request.getServerName());
        if (allowAll || LOOPBACK.contains(host) || allowed.contains(host)) {
            chain.doFilter(request, response);
            return;
        }
        log.warn("Rejected request with Host '{}' - add it to REDIVUE_ALLOWED_HOSTS if this is your own hostname", host);
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("text/plain;charset=UTF-8");
        response.getWriter().write("Host '" + host + "' is not allowed. If you are serving Redivue under this name, "
                + "set REDIVUE_ALLOWED_HOSTS=" + host + " (see DEPLOYMENT.md).");
    }

    /** Lower-case, strip IPv6 brackets and any :port. */
    static String normalize(String host) {
        if (host == null) return "";
        String h = host.trim().toLowerCase(Locale.ROOT);
        if (h.startsWith("[")) {
            int end = h.indexOf(']');
            return end > 0 ? h.substring(1, end) : h;
        }
        int colon = h.indexOf(':');
        // A single colon is host:port; more than one means a bare IPv6 address.
        if (colon >= 0 && colon == h.lastIndexOf(':')) h = h.substring(0, colon);
        return h;
    }
}
