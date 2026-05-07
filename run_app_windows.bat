<<<<<<< HEAD
@echo off
setlocal EnableExtensions

REM One-click Windows runner for the SDM project.
REM It finds Rscript, prepares packages/default data, then starts the Shiny app.

cd /d "%~dp0"

set "RSCRIPT="

where Rscript.exe >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%R in ('where Rscript.exe') do (
    if not defined RSCRIPT set "RSCRIPT=%%R"
  )
)

if not defined RSCRIPT (
  for /d %%D in ("C:\Program Files\R\R-*") do (
    if exist "%%D\bin\Rscript.exe" set "RSCRIPT=%%D\bin\Rscript.exe"
  )
)

if not defined RSCRIPT (
  for /d %%D in ("C:\Program Files (x86)\R\R-*") do (
    if exist "%%D\bin\Rscript.exe" set "RSCRIPT=%%D\bin\Rscript.exe"
  )
)

if not defined RSCRIPT (
  echo.
  echo ERROR: Rscript.exe was not found.
  echo Install R for Windows from: https://cran.r-project.org/bin/windows/base/
  echo Then run this file again from the extracted project folder.
  echo.
  pause
  exit /b 1
)

echo Using Rscript: "%RSCRIPT%"
echo Project folder: %CD%
echo.

if not exist "app.R" (
  echo ERROR: app.R was not found in this folder.
  echo You may be in the wrong nested folder, or the zip did not extract correctly.
  echo Look for the folder that contains app.R and run this .bat from there.
  echo.
  dir
  pause
  exit /b 1
)

if not exist "R\optimized_sdm.R" if not exist "optimized_sdm.R" (
  echo ERROR: optimized_sdm.R was not found.
  echo The zip is incomplete. It must contain either:
  echo   R\optimized_sdm.R
  echo or:
  echo   optimized_sdm.R
  echo.
  echo Current folder contents:
  dir
  echo.
  if exist "R" (
    echo R folder contents:
    dir "R"
  ) else (
    echo There is no R folder in this extracted project.
  )
  echo.
  pause
  exit /b 1
)

=======
@echo off
setlocal EnableExtensions

REM One-click Windows runner for the SDM project.
REM It finds Rscript, prepares packages/default data, then starts the Shiny app.

cd /d "%~dp0"

set "RSCRIPT="

where Rscript.exe >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%R in ('where Rscript.exe') do (
    if not defined RSCRIPT set "RSCRIPT=%%R"
  )
)

if not defined RSCRIPT (
  for /d %%D in ("C:\Program Files\R\R-*") do (
    if exist "%%D\bin\Rscript.exe" set "RSCRIPT=%%D\bin\Rscript.exe"
  )
)

if not defined RSCRIPT (
  for /d %%D in ("C:\Program Files (x86)\R\R-*") do (
    if exist "%%D\bin\Rscript.exe" set "RSCRIPT=%%D\bin\Rscript.exe"
  )
)

if not defined RSCRIPT (
  echo.
  echo ERROR: Rscript.exe was not found.
  echo Install R for Windows from: https://cran.r-project.org/bin/windows/base/
  echo Then run this file again from the extracted project folder.
  echo.
  pause
  exit /b 1
)

echo Using Rscript: "%RSCRIPT%"
echo Project folder: %CD%
echo.

if not exist "app.R" (
  echo ERROR: app.R was not found in this folder.
  echo You may be in the wrong nested folder, or the zip did not extract correctly.
  echo Look for the folder that contains app.R and run this .bat from there.
  echo.
  dir
  pause
  exit /b 1
)

if not exist "R\optimized_sdm.R" if not exist "optimized_sdm.R" (
  echo ERROR: optimized_sdm.R was not found.
  echo The zip is incomplete. It must contain either:
  echo   R\optimized_sdm.R
  echo or:
  echo   optimized_sdm.R
  echo.
  echo Current folder contents:
  dir
  echo.
  if exist "R" (
    echo R folder contents:
    dir "R"
  ) else (
    echo There is no R folder in this extracted project.
  )
  echo.
  pause
  exit /b 1
)

>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
if not exist "scripts\windows_setup.R" (
  echo ERROR: scripts\windows_setup.R was not found.
  echo The zip is incomplete. Re-extract the full SDM project folder.
  echo.
  pause
  exit /b 1
)

echo First launch may take a while while R packages and default data are prepared.
echo This same file is used for both preparation and launching.
echo.

"%RSCRIPT%" scripts\windows_setup.R
if errorlevel 1 (
  echo.
  echo Setup failed. Read the messages above.
  echo Common fixes:
  echo   - Make sure the zip was EXTRACTED before running.
  echo   - Make sure you have internet for first-time package installs.
  echo   - Install R from https://cran.r-project.org/bin/windows/base/
  echo.
  pause
  exit /b 1
)

"%RSCRIPT%" launch_app.R
<<<<<<< HEAD

if errorlevel 1 (
  echo.
  echo The app stopped with an error. Read the messages above.
  echo Common fixes:
  echo   - Make sure the zip was EXTRACTED before running.
  echo   - Make sure you have internet for first-time package/WorldClim downloads.
  echo   - Try setting a different port: set PORT=3839 then run again.
  echo.
  pause
  exit /b 1
)

pause
=======

if errorlevel 1 (
  echo.
  echo The app stopped with an error. Read the messages above.
  echo Common fixes:
  echo   - Make sure the zip was EXTRACTED before running.
  echo   - Make sure you have internet for first-time package/WorldClim downloads.
  echo   - Try setting a different port: set PORT=3839 then run again.
  echo.
  pause
  exit /b 1
)

pause
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)
