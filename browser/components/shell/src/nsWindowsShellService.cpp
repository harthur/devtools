/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Shell Service.
 *
 * The Initial Developer of the Original Code is mozilla.org.
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Ben Goodger    <ben@mozilla.org>       (Clients, Mail, New Default Browser)
 *  Joe Hewitt     <hewitt@netscape.com>   (Set Background)
 *  Blake Ross     <blake@cs.stanford.edu  (Desktop Color, DDE support)
 *  Jungshik Shin  <jshin@mailaps.org>     (I18N)
 *  Robert Strong  <robert.bugzilla@gmail.com>  (Long paths, DDE)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

#include "gfxIImageFrame.h"
#include "imgIContainer.h"
#include "imgIRequest.h"
#include "nsCRT.h"
#include "nsIDOMDocument.h"
#include "nsIDOMElement.h"
#include "nsIDOMHTMLImageElement.h"
#include "nsIImageLoadingContent.h"
#include "nsIPrefService.h"
#include "nsIPrefLocalizedString.h"
#include "nsIServiceManager.h"
#include "nsIStringBundle.h"
#include "nsNetUtil.h"
#include "nsShellService.h"
#include "nsWindowsShellService.h"
#include "nsIProcess.h"
#include "nsICategoryManager.h"
#include "nsBrowserCompsCID.h"
#include "nsNativeCharsetUtils.h"
#include "nsDirectoryServiceUtils.h"
#include "nsAppDirectoryServiceDefs.h"
#include "shlobj.h"

#include <mbstring.h>

#ifndef MAX_BUF
#define MAX_BUF 4096
#endif

#define REG_SUCCEEDED(val) \
  (val == ERROR_SUCCESS)

#define REG_FAILED(val) \
  (val != ERROR_SUCCESS)

NS_IMPL_ISUPPORTS2(nsWindowsShellService, nsIWindowsShellService, nsIShellService)

static nsresult
OpenUserKeyForReading(HKEY aStartKey, const char* aKeyName, HKEY* aKey)
{
  DWORD result = ::RegOpenKeyEx(aStartKey, aKeyName, 0, KEY_READ, aKey);

  switch (result) {
  case ERROR_SUCCESS:
    break;
  case ERROR_ACCESS_DENIED:
    return NS_ERROR_FILE_ACCESS_DENIED;
  case ERROR_FILE_NOT_FOUND:
    if (aStartKey == HKEY_LOCAL_MACHINE) {
      // prevent infinite recursion on the second pass through here if 
      // ::RegOpenKeyEx fails in the all-users case. 
      return NS_ERROR_NOT_AVAILABLE;
    }
    return OpenUserKeyForReading(HKEY_LOCAL_MACHINE, aKeyName, aKey);
  }
  return NS_OK;
}

static nsresult
OpenKeyForWriting(const char* aKeyName, HKEY* aKey, PRBool aForAllUsers, PRBool aCreate)
{
  nsresult rv = NS_OK;

  HKEY rootKey = aForAllUsers ? HKEY_LOCAL_MACHINE : HKEY_CURRENT_USER;
  DWORD result = ::RegOpenKeyEx(rootKey, aKeyName, 0, KEY_READ | KEY_WRITE, aKey);

  switch (result) {
  case ERROR_SUCCESS:
    break;
  case ERROR_ACCESS_DENIED:
    return NS_ERROR_FILE_ACCESS_DENIED;
  case ERROR_FILE_NOT_FOUND:
    if (aCreate)
      result = ::RegCreateKey(HKEY_LOCAL_MACHINE, aKeyName, aKey);
    rv = NS_ERROR_FILE_NOT_FOUND;
    break;
  }
  return rv;
}

///////////////////////////////////////////////////////////////////////////////
// Default Browser Registry Settings
//
// - File Extension Mappings
//   -----------------------
//   The following file extensions:
//    .htm .html .shtml .xht .xhtml 
//   are mapped like so:
//
//   HKCU\SOFTWARE\Classes\.<ext>\      (default)   REG_SZ  FirefoxHTML
//
//   as aliases to the class:
//
//   HKCU\SOFTWARE\Classes\FirefoxHTML\
//     DefaultIcon                      (default)   REG_SZ  <appname>,1
//     shell\open\command               (default)   REG_SZ  <appname> -url "%1"
//
// - Protocol Mappings
//   -----------------
//   The following protocols:
//    HTTP, HTTPS, FTP, GOPHER, CHROME
//   are mapped like so:
//
// HKCU\SOFTWARE\Classes\<protocol>\
//   DefaultIcon                    (default)         REG_SZ  <appname>,0
//   shell\open\command             (default)         REG_SZ <appname> -url "%1"
//   shell\open\ddeexec             (default)         REG_SZ  "%1",,0,0,,,,
//   shell\open\ddeexec             NoActivateHandler REG_SZ
//                     \application (default)         REG_SZ  Firefox
//                     \ifexec      (default)         REG_SZ  ,,0,0,,,,
//                     \topic       (default)         REG_SZ  WWW_OpenURL
//                    
//
// - Windows XP Start Menu Browser
//   -----------------------------
//   The following keys are set to make Firefox appear in the Windows XP
//   Start Menu as the browser:
//   
//   HKCU\SOFTWARE\Clients\StartMenuInternet
//     firefox.exe\DefaultIcon             (default)   REG_SZ  <appname>,0
//     firefox.exe\shell\open\command      (default)   REG_SZ  <appname>
//     firefox.exe\shell\properties        (default)   REG_SZ  Firefox &Options
//     firefox.exe\shell\properties\command(default)   REG_SZ  <appname> -preferences
//
// - Uninstall Information
//   ---------------------
//   Every key that is set has the previous value stored in:
//    
//   HKCU\SOFTWARE\Mozilla\Desktop\        <keyname>   REG_SZ oldval
//
//   If there is no previous value, an empty value is set to indicate that the
//   key should be removed completely. 
//

typedef enum { NO_SUBSTITUTION    = 0x00,
               PATH_SUBSTITUTION  = 0x01,
               EXE_SUBSTITUTION   = 0x02,
               NON_ESSENTIAL      = 0x04} SettingFlags;
typedef struct {
  char* keyName;
  char* valueName;
  char* valueData;

  PRInt32 flags;
} SETTING;

#define SMI "SOFTWARE\\Clients\\StartMenuInternet\\"
#define CLS "SOFTWARE\\Classes\\"
#define DI "\\DefaultIcon"
#define SOP "\\shell\\open\\command"
#define DDE "\\shell\\open\\ddeexec\\"
#define DDE_NAME "Firefox" // This must be kept in sync with ID_DDE_APPLICATION_NAME as defined in splash.rc
#define APP_REG_NAME L"Firefox"
#define DDE_COMMAND "\"%1\",,0,0,,,,"
#define DDE_IFEXEC ",,0,0,,,,"

#define CLS_HTML "FirefoxHTML"
#define VAL_URL_ICON "%APPPATH%,0"
#define VAL_FILE_ICON "%APPPATH%,1"
#define VAL_OPEN "\"%APPPATH%\" -url \"%1\""

#define MAKE_KEY_NAME1(PREFIX, MID) \
  PREFIX MID

#define MAKE_KEY_NAME2(PREFIX, MID, SUFFIX) \
  PREFIX MID SUFFIX

#define MAKE_KEY_NAME3(PREFIX, MID, MID2, SUFFIX) \
  PREFIX MID MID2 SUFFIX

static SETTING gSettings[] = {
  // Extension Manager Keys
  { MAKE_KEY_NAME1(CLS, "MIME\\Database\\Content Type\\application/x-xpinstall;app=firefox"),
    "Extension",
    ".xpi",
    NO_SUBSTITUTION | NON_ESSENTIAL },

  // File Extension Aliases
  { MAKE_KEY_NAME1(CLS, ".htm"),    "", CLS_HTML, NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME1(CLS, ".html"),   "", CLS_HTML, NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME1(CLS, ".shtml"),  "", CLS_HTML, NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME1(CLS, ".xht"),    "", CLS_HTML, NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME1(CLS, ".xhtml"),  "", CLS_HTML, NO_SUBSTITUTION | NON_ESSENTIAL },

  // File Extension Class
  { MAKE_KEY_NAME2(CLS, CLS_HTML, DI),  "", VAL_FILE_ICON, PATH_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME2(CLS, CLS_HTML, SOP), "", VAL_OPEN, PATH_SUBSTITUTION | NON_ESSENTIAL },

  // Protocol Handlers
  { MAKE_KEY_NAME2(CLS, "HTTP", DI),    "", VAL_URL_ICON, PATH_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "HTTP", SOP),   "", VAL_OPEN, PATH_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "HTTPS", DI),   "", VAL_URL_ICON, PATH_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "HTTPS", SOP),  "", VAL_OPEN, PATH_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "FTP", DI),     "", VAL_URL_ICON, PATH_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME2(CLS, "FTP", SOP),    "", VAL_OPEN, PATH_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME2(CLS, "GOPHER", DI),  "", VAL_URL_ICON, PATH_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME2(CLS, "GOPHER", SOP), "", VAL_OPEN, PATH_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME2(CLS, "CHROME", DI),  "", VAL_URL_ICON, PATH_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME2(CLS, "CHROME", SOP), "", VAL_OPEN, PATH_SUBSTITUTION | NON_ESSENTIAL },

  // DDE settings
  { MAKE_KEY_NAME2(CLS, CLS_HTML, DDE), "", DDE_COMMAND, NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, CLS_HTML, DDE, "Application"), "", DDE_NAME, NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, CLS_HTML, DDE, "Topic"), "", "WWW_OpenURL", NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, CLS_HTML, DDE, "ifexec"), "", DDE_IFEXEC, NO_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "HTTP", DDE), "", DDE_COMMAND, NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "HTTP", DDE, "Application"), "", DDE_NAME, NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "HTTP", DDE, "Topic"), "", "WWW_OpenURL", NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "HTTP", DDE, "ifexec"), "", DDE_IFEXEC, NO_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "HTTPS", DDE), "", DDE_COMMAND, NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "HTTPS", DDE, "Application"), "", DDE_NAME, NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "HTTPS", DDE, "Topic"), "", "WWW_OpenURL", NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "HTTPS", DDE, "ifexec"), "", DDE_IFEXEC, NO_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "FTP", DDE), "", DDE_COMMAND, NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "FTP", DDE, "Application"), "", DDE_NAME, NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "FTP", DDE, "Topic"), "", "WWW_OpenURL", NO_SUBSTITUTION },
  { MAKE_KEY_NAME3(CLS, "FTP", DDE, "ifexec"), "", DDE_IFEXEC, NO_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "GOPHER", DDE), "", DDE_COMMAND, NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME3(CLS, "GOPHER", DDE, "Application"), "", DDE_NAME, NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME3(CLS, "GOPHER", DDE, "Topic"), "", "WWW_OpenURL", NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME3(CLS, "GOPHER", DDE, "ifexec"), "", DDE_IFEXEC, NO_SUBSTITUTION },
  { MAKE_KEY_NAME2(CLS, "CHROME", DDE), "", DDE_COMMAND, NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME3(CLS, "CHROME", DDE, "Application"), "", DDE_NAME, NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME3(CLS, "CHROME", DDE, "Topic"), "", "WWW_OpenURL", NO_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME3(CLS, "CHROME", DDE, "ifexec"), "", DDE_IFEXEC, NO_SUBSTITUTION },

  // Windows XP Start Menu
  { MAKE_KEY_NAME2(SMI, "%APPEXE%", DI),  
    "", 
    "%APPPATH%,0", 
    PATH_SUBSTITUTION | EXE_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME2(SMI, "%APPEXE%", SOP), 
    "", 
    "%APPPATH%",   
    PATH_SUBSTITUTION | EXE_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME1(SMI, "%APPEXE%\\shell\\properties\\command"),
    "", 
    "\"%APPPATH%\" -preferences",
    PATH_SUBSTITUTION | EXE_SUBSTITUTION | NON_ESSENTIAL },
  { MAKE_KEY_NAME1(SMI, "%APPEXE%\\shell\\safemode\\command"),
    "", 
    "\"%APPPATH%\" -safe-mode",
    PATH_SUBSTITUTION | EXE_SUBSTITUTION | NON_ESSENTIAL }

  // These values must be set by hand, since they contain localized strings.
  //     firefox.exe\shell\properties        (default)   REG_SZ  Firefox &Options
  //     firefox.exe\shell\safemode          (default)   REG_SZ  Firefox &Safe Mode
};


// Support for versions of shlobj.h that don't include the Vista API's
#if !defined(IApplicationAssociationRegistration)

typedef enum tagASSOCIATIONLEVEL
{
  AL_MACHINE,
  AL_EFFECTIVE,
  AL_USER
} ASSOCIATIONLEVEL;

typedef enum tagASSOCIATIONTYPE
{
  AT_FILEEXTENSION,
  AT_URLPROTOCOL,
  AT_STARTMENUCLIENT,
  AT_MIMETYPE
} ASSOCIATIONTYPE;

MIDL_INTERFACE("4e530b0a-e611-4c77-a3ac-9031d022281b")
IApplicationAssociationRegistration : public IUnknown
{
 public:
  virtual HRESULT STDMETHODCALLTYPE QueryCurrentDefault(LPCWSTR pszQuery,
                                                        ASSOCIATIONTYPE atQueryType,
                                                        ASSOCIATIONLEVEL alQueryLevel,
                                                        LPWSTR *ppszAssociation) = 0;
  virtual HRESULT STDMETHODCALLTYPE QueryAppIsDefault(LPCWSTR pszQuery,
                                                      ASSOCIATIONTYPE atQueryType,
                                                      ASSOCIATIONLEVEL alQueryLevel,
                                                      LPCWSTR pszAppRegistryName,
                                                      BOOL *pfDefault) = 0;
  virtual HRESULT STDMETHODCALLTYPE QueryAppIsDefaultAll(ASSOCIATIONLEVEL alQueryLevel,
                                                         LPCWSTR pszAppRegistryName,
                                                         BOOL *pfDefault) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetAppAsDefault(LPCWSTR pszAppRegistryName,
                                                    LPCWSTR pszSet,
                                                    ASSOCIATIONTYPE atSetType) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetAppAsDefaultAll(LPCWSTR pszAppRegistryName) = 0;
  virtual HRESULT STDMETHODCALLTYPE ClearUserAssociations( void) = 0;
};
#endif

static const CLSID CLSID_ApplicationAssociationReg = {0x591209C7,0x767B,0x42B2,{0x9F,0xBA,0x44,0xEE,0x46,0x15,0xF2,0xC7}};
static const IID   IID_IApplicationAssociationReg  = {0x4e530b0a,0xe611,0x4c77,{0xa3,0xac,0x90,0x31,0xd0,0x22,0x28,0x1b}};


PRBool
nsWindowsShellService::IsDefaultBrowserVista(PRBool aStartupCheck, PRBool* aIsDefaultBrowser)
{
  IApplicationAssociationRegistration* pAAR;
  
  HRESULT hr = CoCreateInstance (CLSID_ApplicationAssociationReg,
                                 NULL,
                                 CLSCTX_INPROC,
                                 IID_IApplicationAssociationReg,
                                 (void**)&pAAR);
  
  if (SUCCEEDED(hr))
  {
    hr = pAAR->QueryAppIsDefaultAll(AL_EFFECTIVE,
                                    APP_REG_NAME,
                                    aIsDefaultBrowser);
    
    // If this is the first browser window, maintain internal state that we've
    // checked this session (so that subsequent window opens don't show the 
    // default browser dialog).
    if (aStartupCheck)
      mCheckedThisSession = PR_TRUE;
    
    pAAR->Release();
    return PR_TRUE;
  }
  
  return PR_FALSE;
}

PRBool
nsWindowsShellService::SetDefaultBrowserVista()
{
  IApplicationAssociationRegistration* pAAR;
  
  HRESULT hr = CoCreateInstance (CLSID_ApplicationAssociationReg,
                                 NULL,
                                 CLSCTX_INPROC,
                                 IID_IApplicationAssociationReg,
                                 (void**)&pAAR);
  
  if (SUCCEEDED(hr))
  {
    hr = pAAR->SetAppAsDefaultAll(APP_REG_NAME);
    
    pAAR->Release();
    return PR_TRUE;
  }
  
  return PR_FALSE;
}

NS_IMETHODIMP
nsWindowsShellService::IsDefaultBrowser(PRBool aStartupCheck, PRBool* aIsDefaultBrowser)
{
  if (IsDefaultBrowserVista(aStartupCheck, aIsDefaultBrowser))
    return NS_OK;

  SETTING* settings;
  SETTING* end = gSettings + sizeof(gSettings)/sizeof(SETTING);

  *aIsDefaultBrowser = PR_TRUE;

  char exePath[MAX_BUF];
  if (!::GetModuleFileName(0, exePath, MAX_BUF))
    return NS_ERROR_FAILURE;

  nsCAutoString appLongPath(exePath);

  // Support short path to the exe so if it is already set the user is not
  // prompted to set the default browser again.
  if (!::GetShortPathName(exePath, exePath, sizeof(exePath)))
    return NS_ERROR_FAILURE;

  nsCAutoString appShortPath;
  ToUpperCase(appShortPath = exePath);

  nsCOMPtr<nsILocalFile> lf;
  nsresult rv = NS_NewNativeLocalFile(nsDependentCString(exePath), PR_TRUE,
                                      getter_AddRefs(lf));
  if (NS_FAILED(rv))
    return rv;

  nsCAutoString exeName;
  rv = lf->GetNativeLeafName(exeName);
  if (NS_FAILED(rv))
    return rv;
  ToUpperCase(exeName);

  char currValue[MAX_BUF];
  for (settings = gSettings; settings < end; ++settings) {
    if (settings->flags & NON_ESSENTIAL)
      continue; // This is not a registry key that determines whether
                // or not we consider Firefox the "Default Browser."

    nsCAutoString dataLongPath(settings->valueData);
    nsCAutoString dataShortPath(settings->valueData);
    nsCAutoString key(settings->keyName);
    if (settings->flags & PATH_SUBSTITUTION) {
      PRInt32 offset = dataLongPath.Find("%APPPATH%");
      dataLongPath.Replace(offset, 9, appLongPath);
      // Remove the quotes around %APPPATH% in VAL_OPEN for short paths
      PRInt32 offsetQuoted = dataShortPath.Find("\"%APPPATH%\"");
      if (offsetQuoted != -1)
        dataShortPath.Replace(offsetQuoted, 11, appShortPath);
      else
        dataShortPath.Replace(offset, 9, appShortPath);
    }
    if (settings->flags & EXE_SUBSTITUTION) {
      PRInt32 offset = key.Find("%APPEXE%");
      key.Replace(offset, 8, exeName);
    }

    ::ZeroMemory(currValue, sizeof(currValue));
    HKEY theKey;
    nsresult rv = OpenUserKeyForReading(HKEY_CURRENT_USER, key.get(), &theKey);
    if (NS_SUCCEEDED(rv)) {
      DWORD len = sizeof currValue;
      DWORD result = ::RegQueryValueEx(theKey, settings->valueName, NULL, NULL, (LPBYTE)currValue, &len);
      // Close the key we opened.
      ::RegCloseKey(theKey);
      if (REG_FAILED(result) ||
          !dataLongPath.EqualsIgnoreCase(currValue) &&
          !dataShortPath.EqualsIgnoreCase(currValue)) {
        // Key wasn't set, or was set to something else (something else became the default browser)
        *aIsDefaultBrowser = PR_FALSE;
        break;
      }
    }
  }

  // If this is the first browser window, maintain internal state that we've
  // checked this session (so that subsequent window opens don't show the 
  // default browser dialog).
  if (aStartupCheck)
    mCheckedThisSession = PR_TRUE;

  return NS_OK;
}

NS_IMETHODIMP
nsWindowsShellService::SetDefaultBrowser(PRBool aClaimAllTypes, PRBool aForAllUsers)
{
  if (!aForAllUsers && SetDefaultBrowserVista())
    return NS_OK;

  SETTING* settings;
  SETTING* end = gSettings + sizeof(gSettings)/sizeof(SETTING);

  char exePath[MAX_BUF];
  if (!::GetModuleFileName(0, exePath, MAX_BUF))
    return NS_ERROR_FAILURE;

  nsCAutoString appLongPath(exePath);

  nsCOMPtr<nsILocalFile> lf;
  nsresult rv = NS_NewNativeLocalFile(nsDependentCString(exePath), PR_TRUE,
                                      getter_AddRefs(lf));
  if (NS_FAILED(rv))
    return rv;

  nsCAutoString exeName;
  rv = lf->GetNativeLeafName(exeName);
  if (NS_FAILED(rv))
    return rv;
  ToUpperCase(exeName);

  for (settings = gSettings; settings < end; ++settings) {
    nsCAutoString dataLongPath(settings->valueData);
    nsCAutoString key(settings->keyName);
    if (settings->flags & PATH_SUBSTITUTION) {
      PRInt32 offset = dataLongPath.Find("%APPPATH%");
      dataLongPath.Replace(offset, 9, appLongPath);
    }
    if (settings->flags & EXE_SUBSTITUTION) {
      PRInt32 offset = key.Find("%APPEXE%");
      key.Replace(offset, 8, exeName);
    }

    PRBool replaceExisting = aClaimAllTypes ? PR_TRUE : !(settings->flags & NON_ESSENTIAL);
    SetRegKey(key.get(), settings->valueName, dataLongPath.get(),
              replaceExisting, aForAllUsers);
  }

  // Select the Default Browser for the Windows XP Start Menu
  SetRegKey(NS_LITERAL_CSTRING(SMI).get(), "", exeName.get(), aClaimAllTypes,
            aForAllUsers);

  nsCOMPtr<nsIStringBundleService> bundleService(do_GetService("@mozilla.org/intl/stringbundle;1"));
  if (!bundleService)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIStringBundle> bundle, brandBundle;
  rv = bundleService->CreateBundle(SHELLSERVICE_PROPERTIES, getter_AddRefs(bundle));
  NS_ENSURE_SUCCESS(rv, rv);
  rv = bundleService->CreateBundle(BRAND_PROPERTIES, getter_AddRefs(brandBundle));
  NS_ENSURE_SUCCESS(rv, rv);

  // Create the Start Menu item if it doesn't exist
  nsXPIDLString brandFullName;
  brandBundle->GetStringFromName(NS_LITERAL_STRING("brandFullName").get(),
                                 getter_Copies(brandFullName));
  nsCAutoString nativeFullName;
  // For the now, we use 'A' APIs (see bug 240272, 239279)
  NS_CopyUnicodeToNative(brandFullName, nativeFullName);

  nsCAutoString key1(NS_LITERAL_CSTRING(SMI));
  key1.Append(exeName);
  key1.Append("\\");
  SetRegKey(key1.get(), "", nativeFullName.get(), aClaimAllTypes,
            aForAllUsers);

  // Set the Options and Safe Mode start menu context menu item labels
  nsCAutoString optionsKey(NS_LITERAL_CSTRING(SMI "%APPEXE%\\shell\\properties"));
  optionsKey.ReplaceSubstring("%APPEXE%", exeName.get());

  nsCAutoString safeModeKey(NS_LITERAL_CSTRING(SMI "%APPEXE%\\shell\\safemode"));
  safeModeKey.ReplaceSubstring("%APPEXE%", exeName.get());

  nsXPIDLString brandShortName;
  brandBundle->GetStringFromName(NS_LITERAL_STRING("brandShortName").get(),
                                 getter_Copies(brandShortName));

  const PRUnichar* brandNameStrings[] = { brandShortName.get() };

  // Set the Options menu item
  nsXPIDLString optionsTitle;
  bundle->FormatStringFromName(NS_LITERAL_STRING("optionsLabel").get(),
                               brandNameStrings, 1, getter_Copies(optionsTitle));
  // Set the Safe Mode menu item
  nsXPIDLString safeModeTitle;
  bundle->FormatStringFromName(NS_LITERAL_STRING("safeModeLabel").get(),
                               brandNameStrings, 1, getter_Copies(safeModeTitle));

  // Set the registry keys
  nsCAutoString nativeTitle;
  // For the now, we use 'A' APIs (see bug 240272,  239279)
  NS_CopyUnicodeToNative(optionsTitle, nativeTitle);
  SetRegKey(optionsKey.get(), "", nativeTitle.get(), aClaimAllTypes,
            aForAllUsers);
  // For the now, we use 'A' APIs (see bug 240272,  239279)
  NS_CopyUnicodeToNative(safeModeTitle, nativeTitle);
  SetRegKey(safeModeKey.get(), "", nativeTitle.get(), aClaimAllTypes,
            aForAllUsers);

  // Refresh the Shell
  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0);
  return NS_OK;
}

void
nsWindowsShellService::SetRegKey(const char* aKeyName, const char* aValueName, 
                                 const char* aValue, PRBool aReplaceExisting,
                                 PRBool aForAllUsers)
{
  char buf[MAX_BUF];
  DWORD len = sizeof buf;

  HKEY theKey;
  nsresult rv = OpenKeyForWriting(aKeyName, &theKey, aForAllUsers, PR_TRUE);
  if (NS_FAILED(rv) && rv != NS_ERROR_FILE_NOT_FOUND) return;

  // If we're not allowed to replace an existing key, and one exists (i.e. the
  // result isn't ERROR_FILE_NOT_FOUND, then just return now. 
  if (!aReplaceExisting && rv != NS_ERROR_FILE_NOT_FOUND)
    return;

  // Get the old value
  DWORD result = ::RegQueryValueEx(theKey, aValueName, NULL, NULL, (LPBYTE)buf, &len);

  // Set the new value
  if (REG_FAILED(result) || strcmp(buf, aValue) != 0)
    ::RegSetValueEx(theKey, aValueName, 0, REG_SZ, 
                    (LPBYTE)aValue, nsDependentCString(aValue).Length());
  
  // Close the key we opened.
  ::RegCloseKey(theKey);
}

NS_IMETHODIMP
nsWindowsShellService::GetShouldCheckDefaultBrowser(PRBool* aResult)
{
  // If we've already checked, the browser has been started and this is a 
  // new window open, and we don't want to check again.
  if (mCheckedThisSession) {
    *aResult = PR_FALSE;
    return NS_OK;
  }

  nsCOMPtr<nsIPrefBranch> prefs;
  nsCOMPtr<nsIPrefService> pserve(do_GetService(NS_PREFSERVICE_CONTRACTID));
  if (pserve)
    pserve->GetBranch("", getter_AddRefs(prefs));

  prefs->GetBoolPref(PREF_CHECKDEFAULTBROWSER, aResult);

  return NS_OK;
}

NS_IMETHODIMP
nsWindowsShellService::SetShouldCheckDefaultBrowser(PRBool aShouldCheck)
{
  nsCOMPtr<nsIPrefBranch> prefs;
  nsCOMPtr<nsIPrefService> pserve(do_GetService(NS_PREFSERVICE_CONTRACTID));
  if (pserve)
    pserve->GetBranch("", getter_AddRefs(prefs));

  prefs->SetBoolPref(PREF_CHECKDEFAULTBROWSER, aShouldCheck);

  return NS_OK;
}

static nsresult
WriteBitmap(nsIFile* aFile, gfxIImageFrame* aImage)
{
  PRInt32 width, height;
  aImage->GetWidth(&width);
  aImage->GetHeight(&height);

  PRUint8* bits;
  PRUint32 length;
  aImage->LockImageData();
  aImage->GetImageData(&bits, &length);
  if (!bits) {
      aImage->UnlockImageData();
      return NS_ERROR_FAILURE;
  }

  PRUint32 bpr;
  aImage->GetImageBytesPerRow(&bpr);
  PRInt32 bitCount = bpr/width;

  // initialize these bitmap structs which we will later
  // serialize directly to the head of the bitmap file
  BITMAPINFOHEADER bmi;
  bmi.biSize = sizeof(BITMAPINFOHEADER);
  bmi.biWidth = width;
  bmi.biHeight = height;
  bmi.biPlanes = 1;
  bmi.biBitCount = (WORD)bitCount*8;
  bmi.biCompression = BI_RGB;
  bmi.biSizeImage = length;
  bmi.biXPelsPerMeter = 0;
  bmi.biYPelsPerMeter = 0;
  bmi.biClrUsed = 0;
  bmi.biClrImportant = 0;

  BITMAPFILEHEADER bf;
  bf.bfType = 0x4D42; // 'BM'
  bf.bfReserved1 = 0;
  bf.bfReserved2 = 0;
  bf.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
  bf.bfSize = bf.bfOffBits + bmi.biSizeImage;

  // get a file output stream
  nsresult rv;

  nsCOMPtr<nsIOutputStream> stream;
  rv = NS_NewLocalFileOutputStream(getter_AddRefs(stream), aFile);
  NS_ENSURE_SUCCESS(rv, rv);

  // write the bitmap headers and rgb pixel data to the file
  rv = NS_ERROR_FAILURE;
  if (stream) {
    PRUint32 written;
    stream->Write((const char*)&bf, sizeof(BITMAPFILEHEADER), &written);
    if (written == sizeof(BITMAPFILEHEADER)) {
      stream->Write((const char*)&bmi, sizeof(BITMAPINFOHEADER), &written);
      if (written == sizeof(BITMAPINFOHEADER)) {
#ifndef MOZ_CAIRO_GFX
        stream->Write((const char*)bits, length, &written);
        if (written == length)
          rv = NS_OK;
#else
        // write out the image data backwards because the desktop won't
        // show bitmaps with negative heights for top-to-bottom
        PRUint32 i = length;
        do {
          i -= bpr;

          stream->Write(((const char*)bits) + i, bpr, &written);
          if (written == bpr) {
            rv = NS_OK;
          } else {
            rv = NS_ERROR_FAILURE;
            break;
          }
        } while (i != 0);
#endif
      }
    }

    stream->Close();
  }

  aImage->UnlockImageData();
  return rv;
}

NS_IMETHODIMP
nsWindowsShellService::SetDesktopBackground(nsIDOMElement* aElement, 
                                            PRInt32 aPosition)
{
  nsresult rv;

  nsCOMPtr<gfxIImageFrame> gfxFrame;

  nsCOMPtr<nsIDOMHTMLImageElement> imgElement(do_QueryInterface(aElement));
  if (!imgElement) {
    // XXX write background loading stuff!
  } 
  else {
    nsCOMPtr<nsIImageLoadingContent> imageContent = do_QueryInterface(aElement, &rv);
    if (!imageContent) return rv;

    // get the image container
    nsCOMPtr<imgIRequest> request;
    rv = imageContent->GetRequest(nsIImageLoadingContent::CURRENT_REQUEST,
                                  getter_AddRefs(request));
    if (!request) return rv;
    nsCOMPtr<imgIContainer> container;
    rv = request->GetImage(getter_AddRefs(container));
    if (!container)
      return NS_ERROR_FAILURE;

    // get the current frame, which holds the image data
    container->GetCurrentFrame(getter_AddRefs(gfxFrame));
  }

  if (!gfxFrame)
    return NS_ERROR_FAILURE;

  // get the file name from localized strings
  nsCOMPtr<nsIStringBundleService>
    bundleService(do_GetService(NS_STRINGBUNDLE_CONTRACTID, &rv));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIStringBundle> shellBundle;
  rv = bundleService->CreateBundle(SHELLSERVICE_PROPERTIES,
                                   getter_AddRefs(shellBundle));
  NS_ENSURE_SUCCESS(rv, rv);
 
  // e.g. "Desktop Background.bmp"
  nsXPIDLString fileLeafName;
  rv = shellBundle->GetStringFromName
                      (NS_LITERAL_STRING("desktopBackgroundLeafNameWin").get(),
                       getter_Copies(fileLeafName));
  NS_ENSURE_SUCCESS(rv, rv);

  // get the profile root directory
  nsCOMPtr<nsIFile> file;
  rv = NS_GetSpecialDirectory(NS_APP_APPLICATION_REGISTRY_DIR,
                              getter_AddRefs(file));
  NS_ENSURE_SUCCESS(rv, rv);

  // eventually, the path is "%APPDATA%\Mozilla\Firefox\Desktop Background.bmp"
  rv = file->Append(fileLeafName);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCAutoString nativePath;
  rv = file->GetNativePath(nativePath);
  NS_ENSURE_SUCCESS(rv, rv);

  // write the bitmap to a file in the profile directory
  rv = WriteBitmap(file, gfxFrame);

  // if the file was written successfully, set it as the system wallpaper
  if (NS_SUCCEEDED(rv)) {
     char   subKey[] = "Control Panel\\Desktop";
     PRBool result = PR_FALSE;
     DWORD  dwDisp = 0;
     HKEY   key;
     // Try to create/open a subkey under HKLM.
     DWORD rc = ::RegCreateKeyEx( HKEY_CURRENT_USER,
                                  subKey,
                                  0,
                                  NULL,
                                  REG_OPTION_NON_VOLATILE,
                                  KEY_WRITE,
                                  NULL,
                                  &key,
                                  &dwDisp );
    if (REG_SUCCEEDED(rc)) {
      unsigned char tile[2];
      unsigned char style[2];
      if (aPosition == BACKGROUND_TILE) {
        tile[0] = '1';
        style[0] = '1';
      }
      else if (aPosition == BACKGROUND_CENTER) {
        tile[0] = '0';
        style[0] = '0';
      }
      else if (aPosition == BACKGROUND_STRETCH) {
        tile[0] = '0';
        style[0] = '2';
      }
      tile[1] = '\0';
      style[1] = '\0';
      ::RegSetValueEx(key, "TileWallpaper", 0, REG_SZ, tile, sizeof(tile));
      ::RegSetValueEx(key, "WallpaperStyle", 0, REG_SZ, style, sizeof(style));
      ::SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, (PVOID) nativePath.get(),
                             SPIF_UPDATEINIFILE | SPIF_SENDWININICHANGE);
      // Close the key we opened.
      ::RegCloseKey(key);
    }
  }
  return rv;
}

NS_IMETHODIMP
nsWindowsShellService::OpenApplication(PRInt32 aApplication)
{
  nsCAutoString application;
  switch (aApplication) {
  case nsIShellService::APPLICATION_MAIL:
    application = NS_LITERAL_CSTRING("Mail");
    break;
  case nsIShellService::APPLICATION_NEWS:
    application = NS_LITERAL_CSTRING("News");
    break;
  }

  // The Default Client section of the Windows Registry looks like this:
  // 
  // Clients\aClient\
  //  e.g. aClient = "Mail"...
  //        \Mail\(default) = Client Subkey Name
  //             \Client Subkey Name
  //             \Client Subkey Name\shell\open\command\ 
  //             \Client Subkey Name\shell\open\command\(default) = path to exe
  //
  nsCAutoString clientKey(NS_LITERAL_CSTRING("SOFTWARE\\Clients\\"));
  clientKey += application;

  // Find the default application for this class.
  HKEY theKey;
  nsresult rv = OpenUserKeyForReading(HKEY_CURRENT_USER, clientKey.get(), &theKey);
  if (NS_FAILED(rv)) return rv;

  char buf[MAX_BUF];
  DWORD type, len = sizeof buf;
  DWORD result = ::RegQueryValueEx(theKey, "", 0, &type, (LPBYTE)&buf, &len);
  if (REG_FAILED(result) || nsDependentCString(buf).IsEmpty()) 
    return NS_OK;

  // Close the key we opened.
  ::RegCloseKey(theKey);

  // Find the "open" command
  clientKey.Append("\\");
  clientKey.Append(buf);
  clientKey.Append("\\shell\\open\\command");

  rv = OpenUserKeyForReading(HKEY_CURRENT_USER, clientKey.get(), &theKey);
  if (NS_FAILED(rv)) return rv;

  ::ZeroMemory(buf, sizeof(buf));
  len = sizeof buf;
  result = ::RegQueryValueEx(theKey, "", 0, &type, (LPBYTE)&buf, &len);
  if (REG_FAILED(result) || nsDependentCString(buf).IsEmpty()) 
    return NS_ERROR_FAILURE;

  // Close the key we opened.
  ::RegCloseKey(theKey);

  nsCAutoString path(buf);

  // Look for any embedded environment variables and substitute their 
  // values, as |::CreateProcess| is unable to do this. 
  PRInt32 end = path.Length();
  PRInt32 cursor = 0, temp = 0;
  ::ZeroMemory(buf, sizeof(buf));
  do {
    // XXX : This would not work with multibyte strings. 
    cursor = path.FindChar('%', cursor);
    if (cursor < 0) 
      break;

    temp = path.FindChar('%', cursor + 1);

    ++cursor;

    ::ZeroMemory(&buf, sizeof(buf));
    ::GetEnvironmentVariable(nsCAutoString(Substring(path, cursor, temp - cursor)).get(), 
                             buf, sizeof(buf));
    
    // "+ 2" is to subtract the extra characters used to delimit the environment
    // variable ('%').
    path.Replace((cursor - 1), temp - cursor + 2, nsDependentCString(buf));

    ++cursor;
  }
  while (cursor < end);

  STARTUPINFO si;
  PROCESS_INFORMATION pi;

  ::ZeroMemory(&si, sizeof(STARTUPINFO));
  ::ZeroMemory(&pi, sizeof(PROCESS_INFORMATION));

  char *pathCStr = ToNewCString(path);
  BOOL success = ::CreateProcess(NULL, pathCStr, NULL, NULL, FALSE, 0, NULL, 
                                 NULL, &si, &pi);
  nsMemory::Free(pathCStr);
  if (!success)
    return NS_ERROR_FAILURE;

  return NS_OK;
}

NS_IMETHODIMP
nsWindowsShellService::GetDesktopBackgroundColor(PRUint32* aColor)
{
  PRUint32 color = ::GetSysColor(COLOR_DESKTOP);
  *aColor = (GetRValue(color) << 16) | (GetGValue(color) << 8) | GetBValue(color);
  return NS_OK;
}

NS_IMETHODIMP
nsWindowsShellService::SetDesktopBackgroundColor(PRUint32 aColor)
{
  int aParameters[2] = { COLOR_BACKGROUND, COLOR_DESKTOP };
  BYTE r = (aColor >> 16);
  BYTE g = (aColor << 16) >> 24;
  BYTE b = (aColor << 24) >> 24;
  COLORREF colors[2] = { RGB(r,g,b), RGB(r,g,b) };

  ::SetSysColors(sizeof(aParameters) / sizeof(int), aParameters, colors);

  char   subKey[] = "Control Panel\\Colors";
  PRBool result = PR_FALSE;
  DWORD  dwDisp = 0;
  HKEY   key;
  // Try to create/open a subkey under HKLM.
  DWORD rc = ::RegCreateKeyEx(HKEY_CURRENT_USER, subKey, 0, NULL, 
                              REG_OPTION_NON_VOLATILE, KEY_WRITE, NULL, &key,
                              &dwDisp);
  if (REG_SUCCEEDED(rc)) {
    unsigned char rgb[12];
    sprintf((char*)rgb, "%u %u %u\0", r, g, b);
    ::RegSetValueEx(key, "Background", 0, REG_SZ, (const unsigned char*)rgb, strlen((char*)rgb));
  }
  
  // Close the key we opened.
  ::RegCloseKey(key);
  return NS_OK;
}

NS_IMETHODIMP
nsWindowsShellService::GetUnreadMailCount(PRUint32* aCount)
{
  *aCount = 0;

  HKEY accountKey;
  if (GetMailAccountKey(&accountKey)) {
    DWORD type, unreadCount;
    DWORD len = sizeof unreadCount;
    DWORD result = ::RegQueryValueEx(accountKey, "MessageCount", 0, &type, 
                                     (LPBYTE)&unreadCount, &len);
    if (REG_SUCCEEDED(result)) {
      *aCount = unreadCount;
    }

  // Close the key we opened.
  ::RegCloseKey(accountKey);
  }

  return NS_OK;
}

PRBool
nsWindowsShellService::GetMailAccountKey(HKEY* aResult)
{
  HKEY mailKey;
  DWORD result = ::RegOpenKeyEx(HKEY_CURRENT_USER, 
                                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\UnreadMail\\",
                                0, KEY_ENUMERATE_SUB_KEYS, &mailKey);

  PRInt32 i = 0;
  do {
    char subkeyName[MAX_BUF];
    DWORD len = sizeof subkeyName;
    result = ::RegEnumKeyEx(mailKey, i++, subkeyName, &len, 0, 0, 0, 0);
    if (REG_SUCCEEDED(result)) {
      HKEY accountKey;
      result = ::RegOpenKeyEx(mailKey, subkeyName, 0, KEY_READ, &accountKey);
      if (REG_SUCCEEDED(result)) {
        *aResult = accountKey;
    
        // Close the key we opened.
        ::RegCloseKey(mailKey);
	 
        return PR_TRUE;
      }
    }
    else
      break;
  }
  while (1);

  // Close the key we opened.
  ::RegCloseKey(mailKey);
  return PR_FALSE;
}

NS_IMETHODIMP
nsWindowsShellService::OpenApplicationWithURI(nsILocalFile* aApplication, const nsACString& aURI)
{
  nsresult rv;
  nsCOMPtr<nsIProcess> process = 
    do_CreateInstance("@mozilla.org/process/util;1", &rv);
  if (NS_FAILED(rv))
    return rv;
  
  rv = process->Init(aApplication);
  if (NS_FAILED(rv))
    return rv;
  
  const nsPromiseFlatCString& spec = PromiseFlatCString(aURI);
  const char* specStr = spec.get();
  PRUint32 pid;
  return process->Run(PR_FALSE, &specStr, 1, &pid);
}

