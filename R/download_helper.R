# Helper for background covariate downloads with polling and verification.

download_covariate_bg <- function(log_target, log_append, label, download_fun,
                                   verify_fun = NULL, timeout_sec = 300,
                                   notification_msg = NULL,
                                   kill_on_timeout = FALSE,
                                   args = NULL) {
  log_append(log_target, paste0("Starting ", label, " download..."))
  tryCatch({
    bg <- callr::r_bg(download_fun, args = args, stdout = "|", stderr = "|")
    poll_interval <- if (timeout_sec <= 300) 1 else 2
    max_polls <- ceiling(timeout_sec / poll_interval)
    poll <- 0
    while (bg$is_alive() && poll < max_polls) {
      Sys.sleep(poll_interval)
      lines <- tryCatch(bg$read_output(), error = function(e) character(0))
      if (length(lines) > 0) {
        for (ln in lines[nzchar(lines)]) log_append(log_target, ln)
      }
      poll <- poll + 1
    }
    if (bg$is_alive()) {
      if (kill_on_timeout) bg$kill()
      log_append(log_target, paste0(label, " download timed out (", timeout_sec, " sec).",
                                     if (kill_on_timeout) " Killed." else " Check terminal for progress."))
    } else {
      last_out <- tryCatch(bg$read_output(), error = function(e) character(0))
      if (length(last_out) > 0) for (ln in last_out[nzchar(last_out)]) log_append(log_target, ln)
      if (!is.null(verify_fun)) {
        v <- verify_fun()
        log_append(log_target, paste("Verification:", v$detail))
      }
      if (!is.null(notification_msg)) {
        shiny::showNotification(notification_msg, type = "message", duration = 5)
      }
    }
  }, error = function(e) {
    log_append(log_target, paste("ERROR:", conditionMessage(e)))
  })
}
