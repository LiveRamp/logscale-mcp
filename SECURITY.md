# Security Guide

This document outlines the security practices implemented in the LogScale MCP Server.

## 🔒 Credential Security

### **Environment File Approach**
We use a `.env` file approach to keep credentials secure:

```bash
# 1. Create the .env file
touch .env

# 2. Edit with your credentials
nano .env

# 3. The .env file is automatically gitignored
```

### **Security Benefits**

✅ **Credentials Never in Code**
- API tokens are stored in `.env`, not in shell scripts
- Main codebase contains no sensitive information
- Safe to commit and share publicly

✅ **Version Control Protection**
- `.env` file is in `.gitignore`
- Prevents accidental commits of credentials
- Use documentation examples for the required format without exposing secrets

✅ **Runtime Validation**
- Script validates credentials before starting server
- Clear error messages if configuration is missing
- Fails fast with helpful guidance

✅ **Least Privilege Access**
- Only the startup script needs to read credentials
- MCP server receives credentials via environment variables
- No credential persistence in memory beyond startup

## 🛡️ Network Security

### **SSL/TLS Configuration**
For corporate environments with SSL inspection:

```bash
# Add to your .env file:
SSL_CERT_FILE=/path/to/your/corporate/certificate.pem
```

Common locations:
- **Netskope**: `/Library/Application Support/Netskope/STAgent/data/nscacert.pem`
- **Check with IT** for your organization's certificate

### **Firewall Requirements**
The MCP server needs access to:
- Your LogScale instance (typically HTTPS/443)
- No inbound connections required
- Cursor communicates via stdio (local process communication)

## 🔍 Security Validation

### **Credential Validation**
The startup script performs these checks:

1. **File Existence**: Ensures `.env` file exists
2. **Token Validation**: Rejects default/empty tokens
3. **URL Validation**: Ensures instance URL is configured
4. **Repository Check**: Validates repository name is set

### **Input Validation**
All user-supplied parameters are validated before use:

| Parameter | Validation | Function |
|-----------|-----------|----------|
| Repository names | Whitelist regex `[a-zA-Z0-9_.\-]` | `validateRepoName()` |
| Job IDs | Whitelist regex `[a-zA-Z0-9_\-]` | `validateJobId()` |
| File paths | Directory traversal prevention | `safePath()` |
| Time inputs | Format + type + range validation | `parseTimeInput()` |
| Numeric limits | Min/max bounds enforcement | `normalizeMaxEvents()`, `normalizeMaxChars()` |

### **Error Response Sanitization**
API error responses are sanitized before returning to clients:
- Truncated to 500 characters (configurable) to prevent information leakage
- Newlines collapsed to prevent log injection
- Applied to all REST API, GraphQL, and file operation error paths

### **Error Handling**
```bash
# Example error messages:
ERROR: .env file not found!
ERROR: LOGSCALE_API_TOKEN not configured!
ERROR: LOGSCALE_BASE_URL not configured!
```

## 🚨 Security Best Practices

### **For Users**

1. **Protect Your `.env` File**
   ```bash
   # Set restrictive permissions
   chmod 600 .env
   ```

2. **Regular Token Rotation**
   - Rotate LogScale API tokens periodically
   - Update `.env` file with new tokens
   - Revoke old tokens in LogScale UI

3. **Environment Isolation**
   - Use separate tokens for dev/staging/production
   - Don't share `.env` files between environments
   - Use different LogScale repositories for testing

### **For Contributors**

1. **Never Commit Credentials**
   - Double-check `.gitignore` includes `.env`
   - Use `git status` before commits
   - Consider using git hooks for additional protection

2. **Documentation Security**
   - Use placeholders in documentation examples
   - Never include real tokens in examples
   - Sanitize logs and error messages

3. **Code Review**
   - Review changes to credential handling carefully
   - Ensure no hardcoded secrets
   - Validate error messages don't leak sensitive info

## 🔧 Alternative Security Setups

### **System Environment Variables**
Instead of `.env`, you can use system environment variables:

```bash
# Set in your shell profile (.bashrc, .zshrc, etc.)
export LOGSCALE_API_TOKEN="your-token"
export LOGSCALE_BASE_URL="https://your-instance.com"
export LOGSCALE_REPOSITORY="your-repo"
```

### **External Secret Management**
For enterprise deployments, consider:
- **HashiCorp Vault**: Store and rotate credentials
- **AWS Secrets Manager**: Cloud-based secret storage
- **Azure Key Vault**: Microsoft Azure secret management
- **System Keychain**: macOS/Linux keychain integration

### **Container Security**
When using Docker:
```dockerfile
# Use secrets mounting instead of environment variables
# Mount secrets as files, not env vars
COPY --from=secrets /run/secrets/logscale-token /etc/secrets/
```

## 📊 Security Monitoring

### **Audit Trail**
Monitor your LogScale instance for:
- API token usage patterns
- Unusual query patterns
- Failed authentication attempts
- Access from unexpected IP addresses

### **Log Security**
The MCP server logs:
- ✅ Startup and configuration validation
- ✅ General connection status
- ❌ Never logs API tokens or sensitive data
- ❌ Credentials are not written to any logs

## 🆘 Security Incident Response

### **Compromised Credentials**
If you suspect credential compromise:

1. **Immediate Actions**
   ```bash
   # 1. Revoke the token in LogScale UI
   # 2. Generate a new token
   # 3. Update .env file
   # 4. Restart MCP server
   ```

2. **Investigation**
   - Check LogScale access logs
   - Review recent query history
   - Monitor for suspicious activity
   - Update any shared configurations

### **Reporting Security Issues**
For security vulnerabilities in this MCP server:
- Create a private issue or contact maintainers directly
- Do not publicly disclose security issues
- Include reproduction steps and impact assessment

## ✅ Security Checklist

Before deploying:
- [ ] `.env` file created and configured
- [ ] `.env` file has restrictive permissions (600)
- [ ] `.gitignore` includes `.env` and `node_modules/`
- [ ] No credentials in code or documentation
- [ ] SSL certificate configured (if needed)
- [ ] LogScale API token has minimal required permissions
- [ ] Network firewall allows HTTPS to LogScale instance
- [ ] Monitoring setup for unusual API usage
- [ ] All utility tests passing (`npm test`)

## 🧪 Testing

Run the test suite to verify input validation and security controls:

```bash
npm test
```

Tests cover:
- Repository name injection prevention (SQL injection, path traversal, special characters)
- Job ID format validation (path traversal, URL injection, command injection)
- Path traversal prevention for file operations
- Error text sanitization (truncation, newline collapsing)
- Numeric bounds enforcement
- Time input format validation

This security-first approach ensures your LogScale credentials and data remain protected while providing a smooth user experience.
