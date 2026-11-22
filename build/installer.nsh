!macro CleanLegacyProjectAssociation ROOT
  ReadRegStr $0 ${ROOT} "Software\Classes\.recordly" ""
  StrCmp $0 "LeadCut.Project" 0 +2
    DeleteRegValue ${ROOT} "Software\Classes\.recordly" ""
  ClearErrors
  ReadRegStr $0 ${ROOT} "Software\Classes\.recordly\OpenWithProgids" "LeadCut.Project"
  IfErrors +2
    DeleteRegValue ${ROOT} "Software\Classes\.recordly\OpenWithProgids" "LeadCut.Project"
  ReadRegStr $0 ${ROOT} "Software\Classes\.recordly\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}" ""
  StrCmp $0 "{D5A734BF-6859-4714-93AE-5987592B82CC}" 0 +3
    DeleteRegValue ${ROOT} "Software\Classes\.recordly\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}" ""
    DeleteRegKey /ifempty ${ROOT} "Software\Classes\.recordly\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}"
  DeleteRegKey /ifempty ${ROOT} "Software\Classes\.recordly\ShellEx"
  DeleteRegKey /ifempty ${ROOT} "Software\Classes\.recordly\OpenWithProgids"
  DeleteRegKey /ifempty ${ROOT} "Software\Classes\.recordly"
!macroend

!macro customInstall
  Push $0
  !insertmacro CleanLegacyProjectAssociation SHELL_CONTEXT
  !insertmacro CleanLegacyProjectAssociation HKCU
  Pop $0
  ; electron-builder's generated open command does not quote the executable.
  ; Keep both paths intact when installing under a directory containing spaces.
  WriteRegStr SHELL_CONTEXT "Software\Classes\LeadCut.Project\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\LeadCut.Project\DefaultIcon" "" '$\"$INSTDIR\resources\leadcut-project.ico$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\CLSID\{D5A734BF-6859-4714-93AE-5987592B82CC}" "" "LeadCut Project Thumbnail Provider"
  WriteRegStr SHELL_CONTEXT "Software\Classes\CLSID\{D5A734BF-6859-4714-93AE-5987592B82CC}\InprocServer32" "" "$INSTDIR\resources\LeadCutThumbnail.dll"
  WriteRegStr SHELL_CONTEXT "Software\Classes\CLSID\{D5A734BF-6859-4714-93AE-5987592B82CC}\InprocServer32" "ThreadingModel" "Both"
  WriteRegStr SHELL_CONTEXT "Software\Classes\.leadcut\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}" "" "{D5A734BF-6859-4714-93AE-5987592B82CC}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\LeadCut.Project\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}" "" "{D5A734BF-6859-4714-93AE-5987592B82CC}"
  ; With no override, Explorer adds the associated LeadCut icon at bottom right.
  DeleteRegValue SHELL_CONTEXT "Software\Classes\LeadCut.Project" "TypeOverlay"
  WriteRegDWORD SHELL_CONTEXT "Software\Classes\LeadCut.Project" "Treatment" 0
  WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" "{D5A734BF-6859-4714-93AE-5987592B82CC}" "LeadCut Project Thumbnail Provider"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro RemoveLeadCutProjectAssociation ROOT
  ReadRegStr $0 ${ROOT} "Software\Classes\LeadCut.Project\shell\open\command" ""
  StrCmp $0 '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"' 0 +2
    DeleteRegKey ${ROOT} "Software\Classes\LeadCut.Project"
  ReadRegStr $0 ${ROOT} "Software\Classes\.leadcut" ""
  StrCmp $0 "LeadCut.Project" 0 +2
    DeleteRegValue ${ROOT} "Software\Classes\.leadcut" ""
  DeleteRegValue ${ROOT} "Software\Classes\.leadcut\OpenWithProgids" "LeadCut.Project"
  DeleteRegKey /ifempty ${ROOT} "Software\Classes\.leadcut\OpenWithProgids"
  DeleteRegKey ${ROOT} "Software\Classes\CLSID\{D5A734BF-6859-4714-93AE-5987592B82CC}"
  ReadRegStr $0 ${ROOT} "Software\Classes\.leadcut\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}" ""
  StrCmp $0 "{D5A734BF-6859-4714-93AE-5987592B82CC}" 0 +2
    DeleteRegKey ${ROOT} "Software\Classes\.leadcut\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}"
  DeleteRegKey /ifempty ${ROOT} "Software\Classes\.leadcut\ShellEx"
  DeleteRegKey /ifempty ${ROOT} "Software\Classes\.leadcut"
  DeleteRegValue ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" "{D5A734BF-6859-4714-93AE-5987592B82CC}"
!macroend

!macro customUnInstall
  Push $0
  !insertmacro RemoveLeadCutProjectAssociation SHELL_CONTEXT
  !insertmacro RemoveLeadCutProjectAssociation HKCU
  Pop $0
  !insertmacro UPDATEFILEASSOC
!macroend
