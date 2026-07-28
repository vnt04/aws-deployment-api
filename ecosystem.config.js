module.exports = {
  apps: [
    {
      name: 'aws-deployment-api',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/aws-deployment-api',
      exec_mode: 'cluster',
      // t3.micro chỉ có 1GB RAM — 'max' fork 2 worker, chạy cùng MySQL là OOM.
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,
      // Chờ app listen xong mới coi là online, tránh reload làm rớt request.
      wait_ready: false,
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
