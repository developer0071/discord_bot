module.exports = {
  apps: [
    {
      name: 'discord-regiment-bot',
      script: 'src/index.js',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
    },
    {
      name: 'discord-announcement',
      script: 'reg_announcement/send_message.py',
      interpreter: 'python3', // Change to 'python' if your VPS uses simply 'python'
      cron_restart: '15 0,6,12,18 * * *',
      autorestart: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/announcement-error.log',
      out_file: 'logs/announcement-out.log',
      merge_logs: true,
    }
  ],
};
