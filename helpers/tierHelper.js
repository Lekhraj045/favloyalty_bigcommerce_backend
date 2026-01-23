const Customer = require("../models/Customer");

/**
 * Calculate and update customer tier based on current points
 * @param {Object} customer - Customer document (Mongoose document)
 * @param {Object} pointModel - Point model document with tier configuration
 * @returns {Promise<Object>} - Object with { tierUpdated: boolean, newTier: Object|null, previousTier: Object|null }
 */
async function calculateAndUpdateCustomerTier(customer, pointModel) {
  try {
    // Check if tier system is enabled
    if (!pointModel || !pointModel.tierStatus || !pointModel.tier || pointModel.tier.length === 0) {
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
      (a, b) => a.pointRequired - b.pointRequired
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
      freshCustomer.currentTier.minPointsRequired !== assignedTier.pointRequired ||
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
        `✅ Customer tier updated: ${freshCustomer.email} (${freshCustomer._id}) -> Tier ${assignedTierIndex} (${assignedTier.tierName || 'Tier ' + assignedTierIndex}) | Points: ${customerPoints}`
      );

      return {
        tierUpdated: true,
        newTier: newTier,
        previousTier: previousTier,
        message: `Tier updated from ${previousTier?.tierIndex ?? 'none'} to ${assignedTierIndex}`,
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
      error.message || error
    );
    throw error;
  }
}

module.exports = {
  calculateAndUpdateCustomerTier,
};
