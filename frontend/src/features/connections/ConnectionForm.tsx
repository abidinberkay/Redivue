import { useState } from 'react'
import './ConnectionForm.css'
import type { AuthType, Connection } from '../../types'

interface ConnectionFormProps {
  onAddConnection: (conn: Omit<Connection, 'id'>) => void
}

const AUTH_HINTS: Record<AuthType, { title: string; lines: string[]; examples: string[] }> = {
  PASSWORD: {
    title: 'Password authentication',
    lines: [
      'Enter host, port, and password (optional if Redis has no auth).',
      'Check "Use TLS / SSL" if your server uses TLS — common port is 6380.',
    ],
    examples: [
      'localhost : 6379  (no password)',
      'redis.example.com : 6379  password: secret123',
      'redis-cloud.io : 6380  TLS ✓  password: ...',
    ],
  },
  USERNAME_PASSWORD: {
    title: 'Redis ACL (username + password)',
    lines: [
      'Enter host, port, username, and password.',
      'Your Redis server must be Redis 6+ with ACL users configured.',
    ],
    examples: [
      'localhost : 6379  username: alice  password: mypass',
      'cloud-redis.io : 6380  username: bob  TLS ✓',
    ],
  },
  URL: {
    title: 'Redis URI (redis:// or rediss://)',
    lines: [
      'Format: redis://[user:password@]host[:port][/db]',
      'Use rediss:// (double s) to enable TLS automatically.',
    ],
    examples: [
      'redis://localhost:6379',
      'redis://:password@host:6379/0',
      'rediss://user:pass@cloud-redis.io:6380',
    ],
  },
  SENTINEL: {
    title: 'Redis Sentinel (high availability)',
    lines: [
      'Sentinel monitors Redis masters and handles automatic failover.',
      'Enter the master name and all sentinel node addresses.',
    ],
    examples: [
      'Master name: mymaster',
      'Sentinel nodes: sentinel1:26379,sentinel2:26379,sentinel3:26379',
      'Redis password: the master\'s password (if any)',
    ],
  },
  CLUSTER: {
    title: 'Redis Cluster (sharded)',
    lines: [
      'Connects to a Redis Cluster via seed nodes. Lettuce discovers all other nodes automatically.',
      'Note: only DB 0 is available in cluster mode.',
    ],
    examples: [
      'node1.cluster.local:6379,node2.cluster.local:6379',
      'redis-c1.io:6379,redis-c2.io:6379,redis-c3.io:6379',
    ],
  },
  SOCKET: {
    title: 'Unix domain socket (local only)',
    lines: [
      'Connects via a local Unix socket file — fastest option for same-machine Redis.',
      'Not supported on Windows.',
    ],
    examples: [
      '/var/run/redis/redis.sock',
      '/tmp/redis.sock',
    ],
  },
}

const HOST_PORT_TYPES: AuthType[] = ['PASSWORD', 'USERNAME_PASSWORD']
const CLUSTER_SENTINEL_TYPES: AuthType[] = ['CLUSTER', 'SENTINEL']
const SSH_SUPPORTED_TYPES: AuthType[] = ['PASSWORD', 'USERNAME_PASSWORD']

export default function ConnectionForm({ onAddConnection }: ConnectionFormProps) {
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('6379')
  const [authType, setAuthType] = useState<AuthType>('PASSWORD')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [useTls, setUseTls] = useState(false)
  const [masterName, setMasterName] = useState('')
  const [sentinelNodes, setSentinelNodes] = useState('')
  const [sentinelPassword, setSentinelPassword] = useState('')
  const [clusterNodes, setClusterNodes] = useState('')
  const [socketPath, setSocketPath] = useState('')
  const [error, setError] = useState('')

  // SSH Tunnel
  const [sshEnabled, setSshEnabled] = useState(false)
  const [sshHost, setSshHost] = useState('')
  const [sshPort, setSshPort] = useState('22')
  const [sshUser, setSshUser] = useState('')
  const [sshAuthMode, setSshAuthMode] = useState<'password' | 'key'>('password')
  const [sshPassword, setSshPassword] = useState('')
  const [sshPrivateKey, setSshPrivateKey] = useState('')
  const [sshPrivateKeyPassphrase, setSshPrivateKeyPassphrase] = useState('')

  // TLS Certificates
  const [tlsSkipVerify, setTlsSkipVerify] = useState(false)
  const [tlsTrustMode, setTlsTrustMode] = useState<'system' | 'skip' | 'custom'>('system')
  const [tlsCaCert, setTlsCaCert] = useState('')
  const [tlsClientCert, setTlsClientCert] = useState('')
  const [tlsClientKey, setTlsClientKey] = useState('')

  const hint = AUTH_HINTS[authType]

  const resetForm = () => {
    setHost('localhost'); setPort('6379'); setPassword(''); setUsername('')
    setUrl(''); setName(''); setUseTls(false); setMasterName('')
    setSentinelNodes(''); setSentinelPassword(''); setClusterNodes(''); setSocketPath('')
    setAuthType('PASSWORD')
    setSshEnabled(false); setSshHost(''); setSshPort('22'); setSshUser('')
    setSshAuthMode('password'); setSshPassword(''); setSshPrivateKey(''); setSshPrivateKeyPassphrase('')
    setTlsSkipVerify(false); setTlsTrustMode('system')
    setTlsCaCert(''); setTlsClientCert(''); setTlsClientKey('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // SSH validation
    if (sshEnabled && SSH_SUPPORTED_TYPES.includes(authType)) {
      if (!sshHost.trim()) { setError('SSH host is required'); return }
      if (!sshUser.trim()) { setError('SSH username is required'); return }
      if (sshAuthMode === 'password' && !sshPassword.trim()) { setError('SSH password is required'); return }
      if (sshAuthMode === 'key' && !sshPrivateKey.trim()) { setError('SSH private key is required'); return }
    }

    const sshFields = sshEnabled && SSH_SUPPORTED_TYPES.includes(authType) ? {
      sshEnabled: true,
      sshHost: sshHost.trim(),
      sshPort: parseInt(sshPort) || 22,
      sshUser: sshUser.trim(),
      sshPassword: sshAuthMode === 'password' ? sshPassword || null : null,
      sshPrivateKey: sshAuthMode === 'key' ? sshPrivateKey || null : null,
      sshPrivateKeyPassphrase: sshAuthMode === 'key' ? sshPrivateKeyPassphrase || null : null,
    } : { sshEnabled: false }

    const tlsFields = useTls && HOST_PORT_TYPES.includes(authType) ? {
      tlsSkipVerify: tlsTrustMode === 'skip',
      tlsCaCert: tlsTrustMode === 'custom' ? tlsCaCert || null : null,
      tlsClientCert: tlsClientCert || null,
      tlsClientKey: tlsClientKey || null,
    } : {}

    if (authType === 'URL') {
      if (!url.trim()) { setError('Redis URL is required'); return }
      onAddConnection({ name: name.trim() || undefined, host: '', port: 0, password: null, db: 0, authType: 'URL', url: url.trim() })

    } else if (authType === 'SENTINEL') {
      if (!masterName.trim()) { setError('Master name is required'); return }
      if (!sentinelNodes.trim()) { setError('Sentinel nodes are required'); return }
      onAddConnection({
        name: name.trim() || undefined, host: '', port: 0,
        password: sentinelPassword || null, db: 0,
        authType: 'SENTINEL', masterName: masterName.trim(),
        sentinelNodes: sentinelNodes.trim(), sentinelPassword: sentinelPassword || null,
      })

    } else if (authType === 'CLUSTER') {
      if (!clusterNodes.trim()) { setError('Seed nodes are required'); return }
      onAddConnection({
        name: name.trim() || undefined, host: '', port: 0,
        password: password || null, db: 0,
        authType: 'CLUSTER', clusterNodes: clusterNodes.trim(), useTls,
      })

    } else if (authType === 'SOCKET') {
      if (!socketPath.trim()) { setError('Socket path is required'); return }
      onAddConnection({
        name: name.trim() || undefined, host: '', port: 0,
        password: password || null, db: 0,
        authType: 'SOCKET', socketPath: socketPath.trim(),
      })

    } else {
      if (!host.trim()) { setError('Host is required'); return }
      const portNum = parseInt(port)
      if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
        setError('Port must be a valid number (1–65535)'); return
      }
      if (authType === 'USERNAME_PASSWORD' && !username.trim()) {
        setError('Username is required for ACL auth'); return
      }
      onAddConnection({
        name: name.trim() || undefined,
        host: host.trim(), port: portNum,
        password: password || null, db: 0, authType, useTls,
        username: authType === 'USERNAME_PASSWORD' ? username.trim() : null,
        url: null,
        ...sshFields,
        ...tlsFields,
      })
    }

    resetForm()
  }

  return (
    <form className="connection-form" onSubmit={handleSubmit}>
      <h2>Add Connection</h2>

      <div className="form-group">
        <label htmlFor="name">Name (optional)</label>
        <input id="name" type="text" placeholder="My Redis" value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div className="form-group">
        <label htmlFor="authType">Auth type</label>
        <select id="authType" value={authType} onChange={e => { setAuthType(e.target.value as AuthType); setUseTls(false) }}>
          <option value="PASSWORD">Password only</option>
          <option value="USERNAME_PASSWORD">ACL (username + password)</option>
          <option value="URL">Redis URL (redis:// / rediss://)</option>
          <option value="SENTINEL">Sentinel (high availability)</option>
          <option value="CLUSTER">Cluster (sharded)</option>
          <option value="SOCKET">Unix socket (local)</option>
        </select>
      </div>

      <div className="auth-hint">
        <span className="auth-hint-icon">ℹ</span>
        <div className="auth-hint-body">
          <strong>{hint.title}</strong>
          {hint.lines.map((l, i) => <p key={i}>{l}</p>)}
          <div className="auth-hint-examples">
            {hint.examples.map((ex, i) => <code key={i}>{ex}</code>)}
          </div>
        </div>
      </div>

      {/* URL mode */}
      {authType === 'URL' && (
        <div className="form-group">
          <label htmlFor="url">Redis URL</label>
          <input id="url" type="text" placeholder="redis://user:pass@host:6379/0"
            value={url} onChange={e => setUrl(e.target.value)} required />
        </div>
      )}

      {/* Sentinel mode */}
      {authType === 'SENTINEL' && (<>
        <div className="form-group">
          <label htmlFor="masterName">Master name</label>
          <input id="masterName" type="text" placeholder="mymaster"
            value={masterName} onChange={e => setMasterName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="sentinelNodes">Sentinel nodes</label>
          <input id="sentinelNodes" type="text" placeholder="host1:26379,host2:26379,host3:26379"
            value={sentinelNodes} onChange={e => setSentinelNodes(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="sentinelPassword">Redis master password (optional)</label>
          <input id="sentinelPassword" type="password" placeholder="Leave blank if no password"
            value={sentinelPassword} onChange={e => setSentinelPassword(e.target.value)} />
        </div>
      </>)}

      {/* Cluster mode */}
      {authType === 'CLUSTER' && (<>
        <div className="form-group">
          <label htmlFor="clusterNodes">Seed nodes</label>
          <input id="clusterNodes" type="text" placeholder="node1:6379,node2:6379,node3:6379"
            value={clusterNodes} onChange={e => setClusterNodes(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="clusterPassword">Password (optional)</label>
          <input id="clusterPassword" type="password" placeholder="Leave blank if no password"
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="tls-row">
          <label className="tls-label">
            <input type="checkbox" checked={useTls} onChange={e => setUseTls(e.target.checked)} />
            Use TLS / SSL
          </label>
        </div>
        {useTls && (
          <div className="tls-warning">
            <span>⚠</span>
            <div>
              <p>All cluster nodes must have TLS enabled.</p>
              <p>Self-signed certificates may require trust store configuration.</p>
            </div>
          </div>
        )}
      </>)}

      {/* Socket mode */}
      {authType === 'SOCKET' && (<>
        <div className="form-group">
          <label htmlFor="socketPath">Socket path</label>
          <input id="socketPath" type="text" placeholder="/var/run/redis/redis.sock"
            value={socketPath} onChange={e => setSocketPath(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="socketPassword">Password (optional)</label>
          <input id="socketPassword" type="password" placeholder="Leave blank if no password"
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
      </>)}

      {/* Password / ACL modes (host + port) */}
      {HOST_PORT_TYPES.includes(authType) && (<>
        <div className="form-group">
          <label htmlFor="host">Host</label>
          <input id="host" type="text" placeholder="localhost"
            value={host} onChange={e => setHost(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="port">Port</label>
          <input id="port" type="number" placeholder="6379" value={port}
            onChange={e => setPort(e.target.value)} min="1" max="65535" required />
        </div>
        {authType === 'USERNAME_PASSWORD' && (
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input id="username" type="text" placeholder="e.g. alice"
              value={username} onChange={e => setUsername(e.target.value)} required />
          </div>
        )}
        <div className="form-group">
          <label htmlFor="password">Password {authType === 'PASSWORD' ? '(optional)' : ''}</label>
          <input id="password" type="password"
            placeholder={authType === 'PASSWORD' ? 'Leave blank for no-auth Redis' : 'ACL user password'}
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="tls-row">
          <label className="tls-label">
            <input type="checkbox" checked={useTls} onChange={e => setUseTls(e.target.checked)} />
            Use TLS / SSL
          </label>
        </div>
        {useTls && (
          <>
            <div className="tls-cert-section">
              <div className="tls-cert-label">Certificate verification</div>
              <div className="tls-trust-options">
                <label className="tls-radio">
                  <input type="radio" checked={tlsTrustMode === 'system'}
                    onChange={() => { setTlsTrustMode('system'); setTlsSkipVerify(false) }} />
                  System CA (default)
                </label>
                <label className="tls-radio">
                  <input type="radio" checked={tlsTrustMode === 'skip'}
                    onChange={() => { setTlsTrustMode('skip'); setTlsSkipVerify(true) }} />
                  Skip verification <span className="tls-insecure">(insecure)</span>
                </label>
                <label className="tls-radio">
                  <input type="radio" checked={tlsTrustMode === 'custom'}
                    onChange={() => { setTlsTrustMode('custom'); setTlsSkipVerify(false) }} />
                  Custom CA certificate
                </label>
              </div>
              {tlsTrustMode === 'skip' && (
                <div className="tls-warning">
                  <span>⚠</span>
                  <p>Skip verification accepts any certificate — use only for local dev or testing.</p>
                </div>
              )}
              {tlsTrustMode === 'custom' && (
                <div className="form-group">
                  <label htmlFor="tlsCaCert">CA Certificate (PEM)</label>
                  <textarea id="tlsCaCert" rows={4} placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                    value={tlsCaCert} onChange={e => setTlsCaCert(e.target.value)} className="pem-textarea" />
                </div>
              )}
            </div>
            <div className="tls-cert-section">
              <div className="tls-cert-label">Client certificate <span className="tls-optional">(optional — for mutual TLS)</span></div>
              <div className="form-group">
                <label htmlFor="tlsClientCert">Client Certificate (PEM)</label>
                <textarea id="tlsClientCert" rows={4} placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  value={tlsClientCert} onChange={e => setTlsClientCert(e.target.value)} className="pem-textarea" />
              </div>
              <div className="form-group">
                <label htmlFor="tlsClientKey">Client Private Key (PEM)</label>
                <textarea id="tlsClientKey" rows={4} placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                  value={tlsClientKey} onChange={e => setTlsClientKey(e.target.value)} className="pem-textarea" />
                <p className="field-hint">PKCS8 format required. Convert with: <code>openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem</code></p>
              </div>
            </div>
          </>
        )}
      </>)}

      {/* SSH Tunnel (PASSWORD / ACL modes only) */}
      {SSH_SUPPORTED_TYPES.includes(authType) && (
        <div className="ssh-tunnel-section">
          <div className="ssh-tunnel-header">
            <label className="ssh-toggle">
              <input type="checkbox" checked={sshEnabled} onChange={e => setSshEnabled(e.target.checked)} />
              <span>SSH Tunnel</span>
            </label>
            {!sshEnabled && <span className="ssh-hint">Connect via a bastion/jump host</span>}
          </div>

          {sshEnabled && (
            <div className="ssh-tunnel-body">
              <div className="form-row">
                <div className="form-group form-group-grow">
                  <label htmlFor="sshHost">SSH Host</label>
                  <input id="sshHost" type="text" placeholder="bastion.example.com"
                    value={sshHost} onChange={e => setSshHost(e.target.value)} required />
                </div>
                <div className="form-group form-group-fixed">
                  <label htmlFor="sshPort">Port</label>
                  <input id="sshPort" type="number" placeholder="22" value={sshPort}
                    onChange={e => setSshPort(e.target.value)} min="1" max="65535" />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="sshUser">SSH Username</label>
                <input id="sshUser" type="text" placeholder="ubuntu"
                  value={sshUser} onChange={e => setSshUser(e.target.value)} required />
              </div>
              <div className="ssh-auth-tabs">
                <button type="button"
                  className={`ssh-tab ${sshAuthMode === 'password' ? 'active' : ''}`}
                  onClick={() => setSshAuthMode('password')}>Password</button>
                <button type="button"
                  className={`ssh-tab ${sshAuthMode === 'key' ? 'active' : ''}`}
                  onClick={() => setSshAuthMode('key')}>Private Key</button>
              </div>
              {sshAuthMode === 'password' && (
                <div className="form-group">
                  <label htmlFor="sshPassword">SSH Password</label>
                  <input id="sshPassword" type="password" placeholder="SSH password"
                    value={sshPassword} onChange={e => setSshPassword(e.target.value)} />
                </div>
              )}
              {sshAuthMode === 'key' && (
                <>
                  <div className="form-group">
                    <label htmlFor="sshPrivateKey">Private Key (PEM)</label>
                    <textarea id="sshPrivateKey" rows={5}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                      value={sshPrivateKey} onChange={e => setSshPrivateKey(e.target.value)} className="pem-textarea" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="sshPassphrase">Key Passphrase <span className="tls-optional">(optional)</span></label>
                    <input id="sshPassphrase" type="password" placeholder="Leave blank if key has no passphrase"
                      value={sshPrivateKeyPassphrase} onChange={e => setSshPrivateKeyPassphrase(e.target.value)} />
                  </div>
                </>
              )}
              <div className="ssh-info">
                <span>ℹ</span>
                <p>The backend opens an SSH tunnel to <strong>{sshHost || 'SSH host'}</strong> and forwards a local port to <strong>{host || 'Redis host'}:{port}</strong>.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <button type="submit" className="submit-btn">Add Connection</button>
    </form>
  )
}
