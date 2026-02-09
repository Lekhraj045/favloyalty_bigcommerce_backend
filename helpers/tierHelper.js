const Customer = require("../models/Customer");
// Note: queueManager is lazy-loaded in checkAndScheduleTierUpgradeEmail to avoid circular dependency

/**
 * Apply tier multiplier to purchase/order completion points only.
 * Use for points awarded from order completion (spent per currency unit).
 * Signup, birthday, referral, etc. are NOT multiplied.
 *
 * IMPORTANT: Only applies multiplier if tierEnabled is true. If tier system is disabled,
 * returns the base points with multiplier = 1.
 *
 * @param {number} basePoints - Base points (e.g. Math.floor(orderTotal * pointsPerUnit))
 * @param {Object} customer - Customer document with currentTier (must have multiplier)
 * @param {boolean} tierEnabled - Whether the tier system is enabled (pointModel.tierStatus)
 * @returns {{ pointsToAward: number, multiplier: number, basePoints: number }}
 */
function applyTierMultiplierToPurchasePoints(basePoints, customer, tierEnabled = false) {
  const base = Number(basePoints) || 0;
  
  // Only apply tier multiplier if tier system is enabled
  // If tierEnabled is false, always return multiplier = 1 (no boost)
  let multiplier = 1;
  if (tierEnabled) {
    multiplier =
      customer?.currentTier?.multiplier != null &&
      typeof customer.currentTier.multiplier === "number" &&
      customer.currentTier.multiplier > 0
        ? customer.currentTier.multiplier
        : 1;
  }
  
  const pointsToAward = Math.floor(base * multiplier);
  return {
    pointsToAward: Math.max(0, pointsToAward),
    multiplier,
    basePoints: base,
  };
}

/**
 * Calculate and update customer tier based on current points
 * @param {Object} customer - Customer document (Mongoose document)
 * @param {Object} pointModel - Point model document with tier configuration
 * @returns {Promise<Object>} - Object with { tierUpdated: boolean, newTier: Object|null, previousTier: Object|null }
 */
async function calculateAndUpdateCustomerTier(customer, pointModel) {
  try {
    // Check if tier system is enabled
    if (
      !pointModel ||
      !pointModel.tierStatus ||
      !pointModel.tier ||
      pointModel.tier.length === 0
    ) {
      return {
        tierUpdated: false,
        newTier: null,
        previousTier: customer.currentTier || null,
        message: "Tier system is not enabled or no tiers configured",
      };
    }

    // Get fresh customer data to ensure we have latest points
    const freshCustomer = await Customer.findById(customer._id || customer);
    if (!freshCustomer) {
      throw new Error(`Customer not found: ${customer._id || customer}`);
    }

    const customerPoints = freshCustomer.points || 0;

    // Sort tiers by pointRequired in ascending order
    const sortedTiers = [...pointModel.tier].sort(
      (a, b) => a.pointRequired - b.pointRequired,
    );

    // Find the appropriate tier based on customer's points
    let assignedTier = null;
    let assignedTierIndex = 0;

    // Start from highest tier and work down
    for (let i = sortedTiers.length - 1; i >= 0; i--) {
      if (customerPoints >= sortedTiers[i].pointRequired) {
        assignedTier = sortedTiers[i];
        assignedTierIndex = i;
        break;
      }
    }

    // If no tier found (customer has less than minimum), assign first tier
    if (!assignedTier && sortedTiers.length > 0) {
      assignedTier = sortedTiers[0];
      assignedTierIndex = 0;
    }

    if (!assignedTier) {
      return {
        tierUpdated: false,
        newTier: null,
        previousTier: freshCustomer.currentTier || null,
        message: "No tiers available to assign",
      };
    }

    // Determine max points for this tier (points required for next tier, or null if highest)
    const nextTierIndex = assignedTierIndex + 1;
    const maxPoints =
      nextTierIndex < sortedTiers.length
        ? sortedTiers[nextTierIndex].pointRequired - 1
        : null;

    // Store previous tier for comparison
    const previousTier = freshCustomer.currentTier
      ? { ...freshCustomer.currentTier.toObject() }
      : null;

    // Check if tier needs to be updated
    const needsUpdate =
      !freshCustomer.currentTier ||
      freshCustomer.currentTier.tierIndex !== assignedTierIndex ||
      freshCustomer.currentTier.multiplier !== assignedTier.multiplier ||
      freshCustomer.currentTier.minPointsRequired !==
        assignedTier.pointRequired ||
      freshCustomer.currentTier.maxPoints !== maxPoints;

    const newTier = {
      tierIndex: assignedTierIndex,
      multiplier: assignedTier.multiplier,
      minPointsRequired: assignedTier.pointRequired,
      maxPoints: maxPoints,
    };

    if (needsUpdate) {
      // Update customer tier
      freshCustomer.currentTier = newTier;

      // Set nextTier reference if there's a next tier
      if (nextTierIndex < sortedTiers.length) {
        freshCustomer.nextTier = sortedTiers[nextTierIndex]._id;
      } else {
        freshCustomer.nextTier = null;
      }

      await freshCustomer.save();

      console.log(
        `✅ Customer tier updated: ${freshCustomer.email} (${freshCustomer._id}) -> Tier ${assignedTierIndex} (${assignedTier.tierName || "Tier " + assignedTierIndex}) | Points: ${customerPoints}`,
      );

      return {
        tierUpdated: true,
        newTier: newTier,
        previousTier: previousTier,
        message: `Tier updated from ${previousTier?.tierIndex ?? "none"} to ${assignedTierIndex}`,
      };
    } else {
      return {
        tierUpdated: false,
        newTier: newTier,
        previousTier: previousTier,
        message: "Tier unchanged",
      };
    }
  } catch (error) {
    console.error(
      `❌ Error calculating/updating customer tier for customer ${customer._id || customer}:`,
      error.message || error,
    );
    throw error;
  }
}

/**
 * Check if tier was upgraded and schedule tier upgrade email if needed.
 * This function checks all necessary conditions before scheduling the email:
 * 1. Tier system must be enabled (pointModel.tierStatus === true)
 * 2. Tier must have been upgraded (newTierIndex > previousTierIndex) - NOT degraded
 * 3. Email will be scheduled via queueManager
 *
 * @param {Object} tierResult - Result from calculateAndUpdateCustomerTier
 * @param {Object} previousTier - Customer's previous tier (before recalculation), can be null
 * @param {string} customerId - Customer MongoDB ObjectId
 * @param {string} storeId - Store MongoDB ObjectId
 * @param {string} channelId - Channel MongoDB ObjectId
 * @param {Object} pointModel - Point model with tier configuration
 * @returns {Promise<boolean>} - true if email was scheduled, false otherwise
 */
async function checkAndScheduleTierUpgradeEmail(
  tierResult,
  previousTier,
  customerId,
  storeId,
  channelId,
  pointModel,
) {
  try {
    // CRITICAL: Only proceed if tier system is enabled
    if (!pointModel || !pointModel.tierStatus) {
      return false;
    }

    // Only proceed if tier was actually updated
    if (!tierResult || !tierResult.tierUpdated) {
      return false;
    }

    // Check if it's an upgrade (not degradation, not just config sync)
    const previousIndex = previousTier?.tierIndex ?? -1;
    const newIndex = tierResult.newTier?.tierIndex ?? 0;

    // ONLY send on UPGRADE (newIndex > previousIndex)
    if (newIndex <= previousIndex) {
      return false;
    }

    // Get tier name from pointModel
    const sortedTiers = [...pointModel.tier].sort(
      (a, b) => a.pointRequired - b.pointRequired,
    );
    const newTierName =
      sortedTiers[newIndex]?.tierName || `Tier ${newIndex + 1}`;

    // Lazy-load queueManager to avoid circular dependency issues
    const queueManager = require("../queues/queueManager");
    
    // Schedule email job
    await queueManager.addTierUpgradeEmailJob(
      {
        customerId: customerId.toString(),
        storeId: storeId.toString(),
        channelId: channelId.toString(),
        newTierName,
        newTierIndex: newIndex,
      },
      { delay: "in 5 seconds" },
    );

    console.log(
      `📧 Tier upgrade email scheduled for customer ${customerId} -> "${newTierName}" (tier index: ${previousIndex} -> ${newIndex})`,
    );
    return true;
  } catch (err) {
    console.warn(
      `⚠️ Failed to schedule tier upgrade email for customer ${customerId}:`,
      err.message,
    );
    return false;
  }
}

module.exports = {
  applyTierMultiplierToPurchasePoints,
  calculateAndUpdateCustomerTier,
  checkAndScheduleTierUpgradeEmail,
};
