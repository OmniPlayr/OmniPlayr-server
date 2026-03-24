import os

fix = (
    "import asyncio, sys\n"
    "if sys.platform == 'win32':\n"
    "    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())\n"
)

setup_path = os.path.join(os.getcwd(), 'setup', 'server_setup.py')

with open(setup_path, 'r') as f:
    content = f.read()

if 'WindowsProactorEventLoopPolicy' not in content:
    with open(setup_path, 'w') as f:
        f.write(fix + content)

os.system(f'python3 -m pip install -r {os.getcwd()}/setup/requirements.txt')
os.system(f'python3 {setup_path}')