// Restricted Windows command token and private desktop; no global
// account/profile changes.
#pragma once
#define NOMINMAX
#include <aclapi.h>
#include <bcrypt.h>
#include <sddl.h>
#include <string>
#include <vector>
#include <windows.h>
namespace layerfs {
struct RestrictedIdentity {
  HANDLE original = nullptr, token = nullptr;
  PSECURITY_DESCRIPTOR security = nullptr;
  HDESK desktop = nullptr;
  PSID policy = nullptr;
  std::wstring desktop_name;
  ~RestrictedIdentity() {
    if (desktop)
      CloseDesktop(desktop);
    if (security)
      LocalFree(security);
    if (policy)
      LocalFree(policy);
    if (token)
      CloseHandle(token);
    if (original)
      CloseHandle(original);
  }
  DWORD create(PCWSTR sid) {
    if (!sid || wcsncmp(sid, L"S-1-5-21-", 9) ||
        !ConvertStringSidToSidW(sid, &policy) || !IsValidSid(policy) ||
        *GetSidSubAuthorityCount(policy) != 5)
      return ERROR_INVALID_SID;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &original))
      return GetLastError();
    DWORD size = 0;
    GetTokenInformation(original, TokenGroups, nullptr, 0, &size);
    std::vector<BYTE> groups(size);
    if (!GetTokenInformation(original, TokenGroups, groups.data(), size, &size))
      return GetLastError();
    BYTE admin[SECURITY_MAX_SID_SIZE], world[SECURITY_MAX_SID_SIZE],
        users[SECURITY_MAX_SID_SIZE], auth[SECURITY_MAX_SID_SIZE];
    DWORD a = sizeof admin, w = sizeof world, u = sizeof users, t = sizeof auth;
    if (!CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, admin, &a) ||
        !CreateWellKnownSid(WinWorldSid, nullptr, world, &w) ||
        !CreateWellKnownSid(WinBuiltinUsersSid, nullptr, users, &u) ||
        !CreateWellKnownSid(WinAuthenticatedUserSid, nullptr, auth, &t))
      return GetLastError();
    auto group_list = reinterpret_cast<TOKEN_GROUPS *>(groups.data());
    PSID logon = nullptr;
    for (DWORD i = 0; i < group_list->GroupCount; ++i)
      if ((group_list->Groups[i].Attributes & SE_GROUP_LOGON_ID) ==
          SE_GROUP_LOGON_ID)
        logon = group_list->Groups[i].Sid;
    if (!logon)
      return ERROR_NO_SUCH_LOGON_SESSION;
    SID_AND_ATTRIBUTES disabled{admin, 0};
    BYTE restricted[SECURITY_MAX_SID_SIZE];
    DWORD restricted_size = sizeof restricted;
    if (!CreateWellKnownSid(WinRestrictedCodeSid, nullptr, restricted,
                            &restricted_size))
      return GetLastError();
    SID_AND_ATTRIBUTES restricts[] = {{policy, 0}, {world, 0}, {users, 0},
                                      {auth, 0},   {logon, 0}, {restricted, 0}};
    if (!CreateRestrictedToken(original, DISABLE_MAX_PRIVILEGE, 1, &disabled, 0,
                               nullptr, 6, restricts, &token))
      return GetLastError();
    PSID low = nullptr;
    if (!ConvertStringSidToSidW(L"S-1-16-4096", &low))
      return GetLastError();
    TOKEN_MANDATORY_LABEL label{{low, SE_GROUP_INTEGRITY}};
    BOOL ok = SetTokenInformation(token, TokenIntegrityLevel, &label,
                                  sizeof label + GetLengthSid(low));
    DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    LocalFree(low);
    if (error)
      return error;
    if (!IsTokenRestricted(token))
      return ERROR_ACCESS_DENIED;
    BYTE nonce[16];
    if (BCryptGenRandom(nullptr, nonce, sizeof nonce,
                        BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0)
      return ERROR_GEN_FAILURE;
    desktop_name = L"layerfs-command-";
    for (auto byte : nonce) {
      desktop_name += L"0123456789abcdef"[byte >> 4];
      desktop_name += L"0123456789abcdef"[byte & 15];
    }
    DWORD user_size = 0;
    GetTokenInformation(original, TokenUser, nullptr, 0, &user_size);
    std::vector<BYTE> user(user_size);
    if (!GetTokenInformation(original, TokenUser, user.data(), user_size,
                             &user_size))
      return GetLastError();
    if (EqualSid(policy, reinterpret_cast<TOKEN_USER *>(user.data())->User.Sid))
      return ERROR_INVALID_SID;
    PWSTR user_text = nullptr;
    if (!ConvertSidToStringSidW(
            reinterpret_cast<TOKEN_USER *>(user.data())->User.Sid, &user_text))
      return GetLastError();
    std::wstring sddl = L"O:" + std::wstring(user_text) + L"G:" + user_text +
                        L"D:P(A;;GA;;;" + user_text + L")(A;;GA;;;" + sid +
                        L")S:(ML;;NW;;;LW)";
    LocalFree(user_text);
    PSECURITY_DESCRIPTOR defaults = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(), SDDL_REVISION_1, &defaults, nullptr))
      return GetLastError();
    PACL dacl = nullptr;
    BOOL present = FALSE, defaulted = FALSE;
    if (!GetSecurityDescriptorDacl(defaults, &present, &dacl, &defaulted) ||
        !present) {
      LocalFree(defaults);
      return ERROR_INVALID_ACL;
    }
    TOKEN_DEFAULT_DACL token_defaults{dacl};
    BOOL set_defaults = SetTokenInformation(
        token, TokenDefaultDacl, &token_defaults, sizeof token_defaults);
    if (!set_defaults) {
      DWORD cause = GetLastError();
      LocalFree(defaults);
      return cause;
    }
    DWORD token_acl =
        SetSecurityInfo(token, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION,
                        nullptr, nullptr, dacl, nullptr);
    LocalFree(defaults);
    if (token_acl != ERROR_SUCCESS)
      return token_acl;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(), SDDL_REVISION_1, &security, nullptr))
      return GetLastError();
    SECURITY_ATTRIBUTES sa{sizeof sa, security, FALSE};
    desktop =
        CreateDesktopW(desktop_name.c_str(), nullptr, nullptr, 0,
                       DESKTOP_CREATEWINDOW | DESKTOP_READOBJECTS |
                           DESKTOP_WRITEOBJECTS | READ_CONTROL | WRITE_DAC,
                       &sa);
    if (!desktop)
      return GetLastError();
    WCHAR station[256];
    DWORD station_size = sizeof station;
    if (!GetUserObjectInformationW(GetProcessWindowStation(), UOI_NAME, station,
                                   sizeof station, &station_size))
      return GetLastError();
    desktop_name = std::wstring(station) + L"\\" + desktop_name;
    return ERROR_SUCCESS;
  }
};
inline std::wstring quote(PCWSTR text) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (auto p = text; *p; ++p) {
    if (*p == L'\\') {
      ++slashes;
      continue;
    }
    result.append(slashes * (*p == L'"' ? 2 : 1), L'\\');
    if (*p == L'"')
      result += L'\\';
    result += *p;
    slashes = 0;
  }
  result.append(slashes * 2, L'\\');
  return result + L'"';
}
} // namespace layerfs
