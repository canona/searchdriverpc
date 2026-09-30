; Bộ cài tổng SearchDriverPC: Windows 7 SP1 -> Windows 11 trong một file.
; Build bằng: npm run dist:universal  (scripts/build-universal.js truyền các /D bên dưới)
;
; Bên trong chứa sẵn hai bộ cài electron-builder, lúc chạy chọn một:
;   - Windows 10/11 64-bit       -> MAIN_SETUP (Electron mới, còn nhận vá bảo mật)
;   - Windows 7/8/8.1 hoặc 32-bit -> WIN7_SETUP (Electron 22, gồm x64 + ia32)
; Bộ cài con tự hiển thị giao diện và tự đăng ký gỡ cài đặt; file này chỉ chọn và chạy nó.
; Tham số dòng lệnh (vd /S để cài im lặng) được chuyển nguyên cho bộ cài con.

!ifndef VERSION | OUTFILE | MAIN_SETUP | WIN7_SETUP
  !error "Thiếu /DVERSION, /DOUTFILE, /DMAIN_SETUP hoặc /DWIN7_SETUP"
!endif

Unicode true
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

Name "SearchDriverPC ${VERSION}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
SilentInstall silent
; Hai bộ cài con đã nén sẵn, nén lại chỉ tốn thời gian build.
SetCompress off

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SearchDriverPC"
VIAddVersionKey "FileDescription" "SearchDriverPC Setup (Windows 7 - 11)"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT License"

Section
  ${IfNot} ${AtLeastWin7}
    MessageBox MB_ICONSTOP "SearchDriverPC cần Windows 7 SP1 trở lên."
    SetErrorLevel 1
    Quit
  ${EndIf}

  InitPluginsDir
  ${If} ${AtLeastWin10}
  ${AndIf} ${RunningX64}
    File "/oname=$PLUGINSDIR\setup.exe" "${MAIN_SETUP}"
  ${Else}
    File "/oname=$PLUGINSDIR\setup.exe" "${WIN7_SETUP}"
  ${EndIf}

  ; NSIS tự tách /D=<thư mục> khỏi tham số (đưa vào $INSTDIR) -> gắn lại, /D phải đứng cuối.
  ${GetParameters} $0
  ${If} $INSTDIR != ""
    StrCpy $0 "$0 /D=$INSTDIR"
  ${EndIf}
  ExecWait '"$PLUGINSDIR\setup.exe" $0' $1
  SetErrorLevel $1
SectionEnd
