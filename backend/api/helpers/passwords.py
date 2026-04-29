import bcrypt
from api.helpers.log import log

# These helpers just shorten the bycript thing, because I don't want to type that every time.
def password_hash(password: str) -> str:
    log("Hashing password", "debug", "passwords")
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    log("Password hashed successfully", "debug", "passwords")
    return hashed

def password_check(password: str, hash: str) -> bool:
    log("Checking password against hash", "debug", "passwords")
    result = bcrypt.checkpw(password.encode('utf-8'), hash.encode('utf-8'))
    log(f"Password check result: {'match' if result else 'no match'}", "debug", "passwords")
    return result