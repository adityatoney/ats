"""
Database connection module - deprecated.
PostgreSQL has been replaced by Convex. All DB access goes through the Node.js API.
This module is kept as a stub for backward compatibility.
"""

import logging

logger = logging.getLogger(__name__)

logger.info("PostgreSQL connection module deprecated - using Convex via Node.js API")
