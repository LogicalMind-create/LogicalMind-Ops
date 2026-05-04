# SmartBiz Scraper 2FA Setup Guide

## Current Status

✅ **Supabase table created**: `scraper_sessions` table exists  
✅ **Error handling improved**: Better 2FA detection and messaging  
⏳ **Manual login required**: First-time auth must be done by you

## The 2FA Challenge

Amazon SmartBiz requires **Two-Factor Authentication (2FA)** for seller accounts. This blocks full automation since Playwright cannot automatically enter OTP codes.

### How Session Caching Works

The scraper is designed to minimize this issue:

1. **First run**: Fresh login → hits 2FA → you provide OTP code manually → session saved
2. **Subsequent runs**: Reuses saved session → skips login → **no 2FA needed**
3. **After 12 hours**: Session expires → requires fresh login again

**Saved sessions are cached in Supabase's `scraper_sessions` table.**

---

## Solution Options

### ✅ RECOMMENDED: Disable 2FA (Easiest)

1. Go to: https://www.amazon.in/account-security/
2. Find "Two-Step Verification" 
3. Choose one:
   - **Option A**: Disable 2FA completely (not secure, not recommended)
   - **Option B**: Keep 2FA but set up [App Passwords](https://support.amazon.com/en-us/article/A1SR7JUH5D9C9Z)
     - Create an app password: `smartbiz-scraper`
     - Use this app password in `.env` as `SMARTBIZ_PASSWORD`

### 🔄 OPTION 2: Manual Login + Session Seeding

This is what **GitHub Actions will do automatically**:

1. Run scraper locally once:
   ```bash
   node scripts/smartbiz-scraper.js
   ```
2. It will detect 2FA and display helpful options
3. You manually log in to https://smartbiz.amazon.in/
4. After login completes, session is automatically saved to Supabase
5. CI/CD runs will reuse this session for ~12 hours

### 🚀 OPTION 3: GitHub Actions Handles It

The workflow `.github/workflows/smartbiz-poll.yml` is configured to:

- Run every 10 minutes
- Detect 2FA requirements gracefully
- Exit with clear error message instead of hanging
- Allow manual intervention when needed
- Cache valid sessions automatically

---

## First-Time Setup

### Step 1: Create Supabase Table ✅

Already done! The `scraper_sessions` table exists.

### Step 2: Choose Your 2FA Strategy

Pick one of the three options above and follow the steps.

### Step 3: Test Locally

```bash
node scripts/smartbiz-scraper.js
```

**Expected outcomes:**

- **Success**: Session saved, orders scraped ✓
- **2FA prompt**: You complete OTP, session saved ✓
- **Error**: Check screenshot at `C:\Users\kumar\AppData\Local\Temp\smartbiz-debug.png`

### Step 4: GitHub Actions

Once local test works, push to trigger CI/CD:

```bash
git add .env
git commit -m "Initial SmartBiz scraper setup"
git push origin main
```

The workflow runs automatically every 10 minutes.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Email field not found" | Amazon changed login UI. Update selectors in `scripts/smartbiz-scraper.js` |
| "2FA / OTP required" | Choose from 3 options above |
| "No orders found" | Check if SmartBiz page structure changed |
| "Session saved but not reused" | Manually delete old session: `DELETE FROM scraper_sessions WHERE key='smartbiz';` |

---

## Important Notes

- ⏱️ Sessions expire after **12 hours** → requires re-login
- 🔐 Never commit real credentials to Git (use `.env` with secrets)
- 📱 If 2FA app is required, you may need to approve notifications
- 🚨 GitHub Actions will fail gracefully on 2FA → send you an alert email

---

## Next Steps

1. **Do ONE of these:**
   - [ ] Disable 2FA or set up App Password (RECOMMENDED)
   - [ ] Plan for manual login + session seeding
   - [ ] Accept GitHub Actions detection flow

2. **Run locally:**
   ```bash
   cd C:\Users\kumar\OneDrive\Desktop\LogicalMind_Ops
   node scripts/smartbiz-scraper.js
   ```

3. **Commit and push to trigger CI/CD**

---

For questions or issues, check `.github/workflows/smartbiz-poll.yml` and `scripts/smartbiz-scraper.js` for detailed implementation.
