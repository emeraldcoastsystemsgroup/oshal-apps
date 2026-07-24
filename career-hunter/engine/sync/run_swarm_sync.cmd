@echo off
REM Nightly one-way sync: OneDrive jobs.db -> swarm career-hunter corpus + user signals.
REM Registered as Windows Scheduled Task "JobHunterSwarmSync" (daily 9:00 PM), AFTER the
REM old system's 4:00 AM scrape / 12:30 PM score so it captures the full day. The old
REM job-hunter keeps scraping into jobs.db in parallel; this just mirrors it into the swarm.
REM Requires Docker Desktop running + the oshal-local-api container up.
cd /d "%~dp0"
echo [%date% %time%] swarm sync starting >> "swarm-sync.log"
"C:\Users\you\AppData\Local\Programs\Python\Python311\python.exe" sync_jobs_to_swarm.py >> "swarm-sync.log" 2>&1
echo [%date% %time%] swarm sync exit %ERRORLEVEL% >> "swarm-sync.log"
