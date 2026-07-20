@echo off
cd /d "d:\PROJETOS\Auto Trader\Auto Trader"
echo --- Checking PrismaClient import ---
node scripts/check-imports.cjs > check-result.txt 2>&1
type check-result.txt
echo.
echo --- Exit code: %ERRORLEVEL% ---