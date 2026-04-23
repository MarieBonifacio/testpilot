# 🔧 Infinite Loop Fix - Testing Guide

## Root Cause Summary

The infinite loop was caused by a **cascade of four interdependent failures**:

1. **Missing backend endpoint** → `GET /api/projects/{id}` returned 404
2. **Stale localStorage** → Previous session's `projectId=1` was restored
3. **Inefficient useEffect** → Refetch callback recreation triggered re-renders
4. **Poor 401 handling** → Redirect loop on auth errors

All four issues combined to create an unbreakable request loop.

---

## Changes Made

### Backend (`routes/campaigns.js`)
✅ Added `GET /api/projects/:id` endpoint
- Fetches single project by ID with scenario counts
- Returns proper 404 if project doesn't exist
- Validates ID format before querying

### Frontend Auth (`src-react/src/lib/api.ts`)
✅ Clear `projectId` from localStorage on login/logout
- Prevents stale project selection across sessions
✅ Debounce consecutive 401 errors (1s window)
- Prevents rapid redirect loops
✅ Use `window.location.replace()` instead of `href`
- Prevents back button returning to auth state

### ProjectProvider (`src-react/src/lib/hooks.tsx`)
✅ Refactor refetch using `useRef` to prevent re-creation
- Breaks useEffect dependency chain
✅ Clear invalid projectId on 404 errors
- Prevents infinite retry attempts
✅ Validate projectId > 0 before restoring from localStorage

### ProjectSelector (`src-react/src/components/ProjectSelector.tsx`)
✅ Validate restored projectId exists in projects list
- Clear stale selections on component mount
- Prevents orphaned project references

---

## Testing Steps

### 1. Clear Browser Data (Simulate Fresh Install)
```bash
# Open DevTools → Application → Local Storage
# Delete these keys:
#   - testpilot_auth
#   - testpilot_current_project
#   - testpilot_provider
```

### 2. Restart Backend & Frontend
```bash
# Terminal 1: Kill existing processes
Ctrl+C

# Terminal 2: Start fresh
dev.bat
# or
.\dev.ps1
# or
npm run dev:full
```

### 3. Test Login → Project Selection Flow
- Navigate to http://localhost:5173
- You should see **Login page** (not infinite loop)
- Log in with credentials
- You should see **Redaction page** with "— Sélectionner —" (empty project)
- Select a project from the dropdown
- No more GET requests for undefined projects
- Page loads normally

### 4. Verify Network Tab (DevTools)
Open DevTools → Network tab and look for:

**BEFORE FIX (Broken):**
```
GET /api/projects/1 → 404 ❌
GET /api/projects/1/context → 401 ❌
GET /login → 304
[REPEAT INFINITELY]
```

**AFTER FIX (Working):**
```
GET /api/projects → 200 ✅ (list of projects)
GET /api/projects/3 → 200 ✅ (when you select project 3)
GET /api/projects/3/context → 200 ✅
GET /api/projects/3/scenarios → 200 ✅
[NO MORE LOOPS]
```

### 5. Test Cross-Session Persistence
1. Select a project (e.g., "ATHENA")
2. Reload the page (`F5`)
3. **Expected:** Project "ATHENA" is still selected ✅
4. Open DevTools → Application → Storage → `testpilot_current_project`
5. **Should contain:** `3` (or whatever ATHENA's ID is)

### 6. Test Project Deletion Scenario
1. If a project is deleted:
   - Admin deletes project "ATHENA" (id=3)
   - User reloads page with old `projectId=3` in localStorage
   - **Expected:** ProjectSelector clears the invalid selection ✅
   - User sees empty dropdown with "— Sélectionner —"
   - No 404 errors in console

### 7. Test Login with Stale Data
1. Login as User A, select project "ATHENA"
2. Logout (or close browser with dev tools showing storage)
3. Login as User B
4. **Expected:** 
   - User B does NOT see User A's projectId ✅
   - localStorage cleared on login ✅
   - User B sees empty project dropdown ✅

### 8. Logout & Back Button
1. Log in and navigate to a page
2. Click logout
3. Try to use browser back button
4. **Expected:** Back button does NOT return to app ✅
   - Should show login page again
   - `window.location.replace()` prevents back navigation

---

## Expected Console Warnings (Normal)

✅ These are OKAY — they indicate proper error recovery:
```
Error loading project: Error: Projet 1 non trouvé
Project X not found in list, clearing selection
```

❌ These indicate a problem:
```
[Infinite GET /api/projects/1 → 404]
[Rapid GET /login redirects]
```

---

## Verification Checklist

- [ ] Fresh login doesn't trigger infinite requests
- [ ] Project selection works after login
- [ ] Network tab shows proper 200 responses (not 404/401 loop)
- [ ] Project selection persists across page reloads
- [ ] Stale projectId is cleared when switching users
- [ ] No console errors about missing projects
- [ ] Back button after logout shows login (not app state)
- [ ] ProjectSelector validates selected project exists

---

## Performance Impact

✅ **Better performance:**
- Fewer re-renders (useRef breaks useEffect chain)
- No debounced 401 delays (< 1s, unnoticeable)
- Single initial project load (not constant retries)

⚠️ **No breaking changes:**
- API response format unchanged
- localStorage structure unchanged (just cleared on login)
- UI appears identical to users

---

## Rollback (If Needed)

```bash
git revert d573f6f  # Revert this commit
npm install && npm run build
```

---

## Support

If infinite loop persists:
1. **Clear all browser storage:** DevTools → Application → Clear Site Data
2. **Check backend endpoint:** `curl http://localhost:3000/api/projects/1 -H "Authorization: Bearer YOUR_TOKEN"`
3. **Verify backend is running:** `npm start` (should show "✈ TestPilot Server v2.0")
4. **Check frontend port:** Should be http://localhost:5173 (not 5174)

