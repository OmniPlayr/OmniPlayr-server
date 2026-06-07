import os
import sys
import subprocess
import venv

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

venv_dir = os.path.join(os.getcwd(), '.venv')

if not os.path.isdir(venv_dir):
    venv.create(venv_dir, with_pip=True)

bin_dir = os.path.join(venv_dir, 'Scripts' if os.name == 'nt' else 'bin')
python = os.path.join(bin_dir, 'python.exe' if os.name == 'nt' else 'python')
pip = os.path.join(bin_dir, 'pip.exe' if os.name == 'nt' else 'pip')

requirements_path = os.path.join(os.getcwd(), 'setup', 'requirements.txt')

subprocess.run([pip, 'install', '-r', requirements_path], check=True)
subprocess.run([python, setup_path], check=True)