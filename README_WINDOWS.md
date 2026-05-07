# Running The SDM Dashboard Workbench On Windows

`Rscript.exe` is included when you install normal R for Windows. It is not downloaded separately.

<<<<<<< HEAD
Use the latest Windows-ready GitHub Release zip. For `v0.3.0-beta`, use `sdm-dashboard-v0.3.0-beta-windows-ready.zip`; it includes the Windows launcher and default BIOCLIM cache for a faster first launch. Source downloads remain available for developers and users who prefer a smaller archive.
=======
Use the latest Windows-ready GitHub Release zip. For `v0.2.0-beta`, use `sdm-dashboard-v0.2.0-beta-windows-ready.zip`; it includes the Windows launcher and default BIOCLIM cache for a faster first launch. Source downloads remain available for developers and users who prefer a smaller archive.
>>>>>>> db1bc36 (Add complete SDM application with multiple modeling engines)

## One-Click Method

1. Install R for Windows: <https://cran.r-project.org/bin/windows/base/>
2. Extract the SDM zip file. Do not run it from inside the compressed zip viewer.
3. Open the extracted folder.
4. Double-click:

```text
run_app_windows.bat
```

The runner does all preparation and launch steps:

- Finds `Rscript.exe`.
- Installs missing R packages.
- Creates output/cache folders.
- Uses bundled default WorldClim layers when present, or downloads them from `R/config.R` if missing and internet is available.
- Starts the Shiny app.

If the browser does not open, go to:

```text
http://127.0.0.1:3838
```

## OpenTopography Elevation Key

Elevation is optional. If you want to use it often, set the API key once in PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("OPENTOPOGRAPHY_API_KEY", "your_key_here", "User")
```

Close and reopen the terminal/app after setting it. You can also leave this unset and enter the key in the app when elevation is enabled.

## Running From PowerShell

Open PowerShell in the extracted project folder, then run:

```powershell
.\run_app_windows.bat
```

Or run R directly with the optional browser launcher:

```powershell
Rscript launch_app.R
```

The same project also supports direct launch on Linux, macOS, and RStudio terminals with:

```bash
Rscript app.R
```

If `Rscript` is not in PATH, use the full path, for example:

```powershell
& "C:\Program Files\R\R-4.4.3\bin\Rscript.exe" launch_app.R
```

Adjust `R-4.4.3` to the installed R version.

## If Port 3838 Is Busy

In PowerShell:

```powershell
$env:PORT = "3839"
.\run_app_windows.bat
```

Then open:

```text
http://127.0.0.1:3839
```

## Data Files

The app needs occurrence data. Either keep `presence_data.csv` in the project folder, upload a CSV/TSV in the app, or enable the bundled synthetic demo dataset for a workflow check. The demo dataset is artificial, only tests the workflow, and must not be interpreted as a real species distribution.

Windows-ready release zips may include default WorldClim BIO rasters so first launch is faster. If they are missing, the runner/app can download them when internet is available.

Local working folders such as `outputs\`, `checkpoints\`, `logs\`, `Worldclim\`, and `covariates\` may contain generated files, user data, or large caches. They are for local use and should normally stay out of the public source repo.

Optional soil covariates need a local HWSD v2 GeoTIFF, normally:

```text
covariates\hwsd_v2\HWSD_V2_SMU_selected.tif
```

If this file is missing and soil is enabled, the app logs a warning and continues without soil.

## Data Sources And Caveats

WorldClim, OpenTopography, and HWSD v2 are external data products/services with their own citation, licensing, API, and availability requirements. Check those requirements before redistribution.

Presence/background SDM outputs are suitability or relative occurrence-support maps, not confirmed presence/absence maps. Results depend on occurrence quality, sampling bias, selected covariates, spatial extent, background strategy, and modelling assumptions.

## Common Problems

### `Rscript.exe was not found`

Install R from CRAN, then run `run_app_windows.bat` again. If still not found, run with the full path to `Rscript.exe`.

### Browser Says It Cannot Connect

Wait 10-30 seconds and refresh. R packages may still be loading.

### Package Install Fails

Make sure there is internet access. On Windows, CRAN usually installs binary packages, so Rtools is usually not needed for this app.

### Windows Firewall Prompt

Allow access on private networks. The app runs locally on your computer.
