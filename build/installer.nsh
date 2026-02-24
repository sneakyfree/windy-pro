; Windy Pro Custom NSIS Include
; Auto-detects and closes running Windy Pro instances before install/upgrade

!macro customInit
  ; Check if Windy Pro is currently running
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq Windy Pro.exe" /NH'
  Pop $0
  Pop $1
  ${If} $1 != "INFO: No tasks are running which match the specified criteria."
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION \
      "Windy Pro is currently running.$\r$\n$\r$\nThe installer needs to close it before upgrading.$\r$\n$\r$\nClick OK to close Windy Pro and continue, or Cancel to abort." \
      IDOK closeApp IDCANCEL abortInstall

    closeApp:
      ; Kill Windy Pro and any related processes
      nsExec::ExecToStack 'taskkill /F /IM "Windy Pro.exe"'
      nsExec::ExecToStack 'taskkill /F /IM "Windy Pro.exe" /T'
      ; Also kill any orphaned Python server processes from Windy Pro
      nsExec::ExecToStack 'taskkill /F /FI "WINDOWTITLE eq windy-pro-server"'
      ; Give processes time to fully exit
      Sleep 2000
      Goto done

    abortInstall:
      Abort "Installation cancelled. Please close Windy Pro manually and try again."

    done:
  ${EndIf}
!macroend

!macro customUnInit
  ; Same check for uninstaller
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq Windy Pro.exe" /NH'
  Pop $0
  Pop $1
  ${If} $1 != "INFO: No tasks are running which match the specified criteria."
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION \
      "Windy Pro is currently running.$\r$\n$\r$\nIt needs to be closed before uninstalling.$\r$\n$\r$\nClick OK to close it, or Cancel to abort." \
      IDOK closeAppUn IDCANCEL abortUninstall

    closeAppUn:
      nsExec::ExecToStack 'taskkill /F /IM "Windy Pro.exe" /T'
      Sleep 2000
      Goto doneUn

    abortUninstall:
      Abort "Uninstall cancelled."

    doneUn:
  ${EndIf}
!macroend
