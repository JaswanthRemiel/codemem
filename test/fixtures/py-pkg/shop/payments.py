import asyncio
import logging as log

MAX_RETRIES = 3


class PaymentError(Exception):
    """Raised when a charge is declined."""


def charge(amount, token):
    """Charge a card token and return a receipt id."""
    if amount <= 0:
        raise PaymentError("amount must be positive")
    log.info("charging %s", amount)
    return f"receipt-{token}-{amount}"


async def notify(user, message):
    await asyncio.sleep(0)
    log.info("notify %s: %s", user, message)
