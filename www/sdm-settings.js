// SDM Dashboard — Persistent sidebar settings via localStorage
// Saves and restores key sidebar inputs across page refreshes.

(function() {
  var STORAGE_KEY = 'sdm_dashboard_settings';

  // Input IDs to persist (model settings, CV, thresholds, not data-specific ones)
  var PERSIST_IDS = [
    'model_id',
    'cv_strategy',
    'cv_folds',
    'cv_block_size_km',
    'n_cores',
    'threshold',
    'quadratic',
    'vif_reduction',
    'bias_method',
    'background_n',
    'maxnet_features',
    'maxnet_regmult',
    'multi_ensemble_weighting',
    'multi_ensemble_min_auc',
    'multi_ensemble_min_tss',
    'multi_ensemble_power',
    'multi_ensemble_export',
    'esm_min_auc',
    'esm_weighting_metric',
    'esm_power',
    'esm_n_runs',
    'esm_split',
    'future_projection',
    'aggregation_factor',
    'worldclim_res',
    'climate_source',
    'biomod2_ensemble',
    'thin_by_cell',
    'batch_mode',
    'use_elevation',
    'use_soil',
    'use_vegetation'
  ];

  function getInputValue(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  }

  function setInputValue(id, value) {
    var el = document.getElementById(id);
    if (!el || value === null || value === undefined) return;
    if (el.type === 'checkbox') {
      if (el.checked !== value) el.click();
    } else {
      // Use jQuery if available (Shiny bundles it) for proper Shiny binding
      if (window.jQuery) {
        var $el = jQuery('#' + id);
        if ($el.length && $el[0].tagName === 'SELECT') {
          $el.val(value).trigger('change');
        } else {
          $el.val(value).trigger('change');
        }
      } else {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  function saveSettings() {
    var settings = {};
    PERSIST_IDS.forEach(function(id) {
      var v = getInputValue(id);
      if (v !== null) settings[id] = v;
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) { /* localStorage full or unavailable */ }
  }

  function restoreSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var settings = JSON.parse(raw);
      // Delay restoration until Shiny inputs are bound
      setTimeout(function() {
        Object.keys(settings).forEach(function(id) {
          if (PERSIST_IDS.indexOf(id) !== -1) {
            setInputValue(id, settings[id]);
          }
        });
      }, 500);
    } catch (e) { /* corrupt data, ignore */ }
  }

  // Save on any input change (debounced)
  var saveTimer = null;
  if (document.addEventListener) {
    document.addEventListener('change', function() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveSettings, 300);
    });
    document.addEventListener('click', function(e) {
      if (e.target && e.target.type === 'checkbox') {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveSettings, 300);
      }
    });
  }

  // Restore on Shiny session start
  if (window.Shiny) {
    Shiny.addCustomMessageHandler('sdm-restore-settings', function(msg) {
      restoreSettings();
    });
  } else {
    document.addEventListener('DOMContentLoaded', restoreSettings);
  }

  // Expose for manual save/restore
  window.sdmSettings = {
    save: saveSettings,
    restore: restoreSettings
  };
})();
