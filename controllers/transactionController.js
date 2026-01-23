const Transaction = require("../models/Transaction");
const Customer = require("../models/Customer");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const Point = require("../models/Point");
const mongoose = require("mongoose");

/**
 * Get all transactions with filters
 */
const getTransactions = async (req, res, next) => {
  try {
    const {
      storeId,
      channelId,
      customerId,
      type,
      status,
      transactionCategory,
      page = 1,
      limit = 50,
    } = req.query;

    // Validate required parameters
    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "storeId is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid storeId format",
      });
    }

    // Build query
    const query = {
      store_id: new mongoose.Types.ObjectId(storeId),
    };

    if (channelId) {
      query.channel_id = parseInt(channelId);
    }

    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid customerId format",
        });
      }
      query.customerId = new mongoose.Types.ObjectId(customerId);
    }

    if (type) {
      query.type = type;
    }

    if (status) {
      query.status = status;
    }

    if (transactionCategory) {
      query.transactionCategory = transactionCategory;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch transactions
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("customerId", "firstName lastName email")
      .populate("store_id", "store_name store_hash")
      .lean();

    // Get total count
    const total = await Transaction.countDocuments(query);

    console.log(
      `✅ Found ${transactions.length} transactions (total: ${total}) for store ${storeId}`
    );

    // Format response
    const formattedTransactions = transactions.map((transaction) => ({
      id: transaction._id.toString(),
      customerId: transaction.customerId?._id?.toString(),
      customerName: transaction.customerId
        ? `${transaction.customerId.firstName || ""} ${transaction.customerId.lastName || ""}`.trim() ||
          transaction.customerId.email
        : null,
      customerEmail: transaction.customerId?.email,
      storeId: transaction.store_id?._id?.toString(),
      channelId: transaction.channel_id,
      bcCustomerId: transaction.bcCustomerId,
      type: transaction.type,
      transactionCategory: transaction.transactionCategory,
      points: transaction.points,
      description: transaction.description,
      reason: transaction.reason,
      status: transaction.status,
      expiresAt: transaction.expiresAt,
      notificationSent: transaction.notificationSent,
      adminUserId: transaction.adminUserId,
      source: transaction.source,
      metadata: transaction.metadata,
      relatedTransactionId: transaction.relatedTransactionId?.toString(),
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    }));

    res.json({
      success: true,
      data: formattedTransactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Error getting transactions:", error);
    next(error);
  }
};

/**
 * Get a single transaction by ID
 */
const getTransactionById = async (req, res, next) => {
  try {
    const { transactionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Transaction ID format",
      });
    }

    const transaction = await Transaction.findById(transactionId)
      .populate("customerId", "firstName lastName email")
      .populate("store_id", "store_name store_hash")
      .populate("relatedTransactionId")
      .lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    res.json({
      success: true,
      data: {
        id: transaction._id.toString(),
        customerId: transaction.customerId?._id?.toString(),
        customerName: transaction.customerId
          ? `${transaction.customerId.firstName || ""} ${transaction.customerId.lastName || ""}`.trim() ||
            transaction.customerId.email
          : null,
        customerEmail: transaction.customerId?.email,
        storeId: transaction.store_id?._id?.toString(),
        channelId: transaction.channel_id,
        bcCustomerId: transaction.bcCustomerId,
        type: transaction.type,
        transactionCategory: transaction.transactionCategory,
        points: transaction.points,
        description: transaction.description,
        reason: transaction.reason,
        status: transaction.status,
        expiresAt: transaction.expiresAt,
        notificationSent: transaction.notificationSent,
        adminUserId: transaction.adminUserId,
        source: transaction.source,
        metadata: transaction.metadata,
        relatedTransactionId: transaction.relatedTransactionId?.toString(),
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      },
    });
  } catch (error) {
    console.error("❌ Error getting transaction:", error);
    next(error);
  }
};

/**
 * Create a new transaction (for manual adjustments)
 */
const createTransaction = async (req, res, next) => {
  try {
    const {
      customerId,
      storeId,
      channelId,
      type,
      transactionCategory,
      points,
      description,
      reason,
      status,
      expiresAt,
      adminUserId,
      source,
      metadata,
    } = req.body;

    // Validate required fields
    if (!customerId || !storeId || !channelId || !type || points === undefined || !description) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: customerId, storeId, channelId, type, points, description",
      });
    }

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId format",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid storeId format",
      });
    }

    // Get customer to retrieve bcCustomerId
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Verify channel exists
    const channel = await Channel.findOne({
      store_id: new mongoose.Types.ObjectId(storeId),
      channel_id: parseInt(channelId),
    });

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Create transaction
    const transaction = await Transaction.createTransaction({
      customerId: new mongoose.Types.ObjectId(customerId),
      store_id: new mongoose.Types.ObjectId(storeId),
      channel_id: parseInt(channelId),
      bcCustomerId: customer.bcCustomerId,
      type,
      transactionCategory,
      points: parseFloat(points),
      description,
      reason,
      status: status || "completed",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      adminUserId,
      source: source || "admin_panel",
      metadata: metadata || {},
    });

    // Update customer points if status is completed
    if (transaction.status === "completed") {
      await Customer.updatePoints(
        new mongoose.Types.ObjectId(customerId),
        transaction.points,
        transaction.type
      );

      // Recalculate customer tier after points update
      try {
        // Get Point configuration to check tier settings
        const point = await Point.findOne({
          store_id: new mongoose.Types.ObjectId(storeId),
          channel_id: channel._id,
        });

        // Only recalculate if tier system is enabled
        if (point && point.tierStatus && point.tier && point.tier.length > 0) {
          // Get updated customer with new points
          const updatedCustomer = await Customer.findById(customerId);
          if (updatedCustomer) {
            const customerPoints = updatedCustomer.points || 0;

            // Sort tiers by pointRequired in ascending order
            const sortedTiers = [...point.tier].sort(
              (a, b) => a.pointRequired - b.pointRequired
            );

            // Find the appropriate tier based on customer's points
            let assignedTier = null;
            let assignedTierIndex = 0;

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

            if (assignedTier) {
              // Determine max points for this tier (points required for next tier, or null if highest)
              const nextTierIndex = assignedTierIndex + 1;
              const maxPoints =
                nextTierIndex < sortedTiers.length
                  ? sortedTiers[nextTierIndex].pointRequired - 1
                  : null;

              // Check if tier needs to be updated
              const needsUpdate =
                !updatedCustomer.currentTier ||
                updatedCustomer.currentTier.tierIndex !== assignedTierIndex ||
                updatedCustomer.currentTier.multiplier !== assignedTier.multiplier ||
                updatedCustomer.currentTier.minPointsRequired !== assignedTier.pointRequired ||
                updatedCustomer.currentTier.maxPoints !== maxPoints;

              if (needsUpdate) {
                updatedCustomer.currentTier = {
                  tierIndex: assignedTierIndex,
                  multiplier: assignedTier.multiplier,
                  minPointsRequired: assignedTier.pointRequired,
                  maxPoints: maxPoints,
                };
                await updatedCustomer.save();
                console.log(
                  `✅ Customer tier updated: ${updatedCustomer.email} -> Tier ${assignedTierIndex} (${assignedTier.tierName})`
                );
              }
            }
          }
        }
      } catch (tierError) {
        // Log error but don't fail the transaction creation
        console.error("⚠️ Error recalculating customer tier after points adjustment:", tierError);
      }
    }

    console.log(`✅ Transaction created: ${transaction._id}`);

    res.status(201).json({
      success: true,
      message: "Transaction created successfully",
      data: {
        id: transaction._id.toString(),
        type: transaction.type,
        points: transaction.points,
        description: transaction.description,
        status: transaction.status,
      },
    });
  } catch (error) {
    console.error("❌ Error creating transaction:", error);
    next(error);
  }
};

/**
 * Get customer transaction history
 */
const getCustomerTransactions = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const {
      type,
      status,
      transactionCategory,
      page = 1,
      limit = 50,
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Customer ID format",
      });
    }

    const filters = {};
    if (type) filters.type = type;
    if (status) filters.status = status;
    if (transactionCategory) filters.transactionCategory = transactionCategory;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await Transaction.findByCustomer(customerId, {
      limit: parseInt(limit),
      skip,
      sort: { createdAt: -1 },
      filters,
    });

    const total = await Transaction.countDocuments({
      customerId: new mongoose.Types.ObjectId(customerId),
      ...filters,
    });

    // Format response
    const formattedTransactions = transactions.map((transaction) => ({
      id: transaction._id.toString(),
      type: transaction.type,
      transactionCategory: transaction.transactionCategory,
      points: transaction.points,
      description: transaction.description,
      reason: transaction.reason,
      status: transaction.status,
      expiresAt: transaction.expiresAt,
      notificationSent: transaction.notificationSent,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    }));

    res.json({
      success: true,
      data: formattedTransactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Error getting customer transactions:", error);
    next(error);
  }
};

/**
 * Bulk import customer points from CSV data
 */
const bulkImportPoints = async (req, res, next) => {
  try {
    const { storeId, channelId, importType, customers } = req.body;

    // Validate required fields
    if (!storeId || !channelId || !importType || !customers || !Array.isArray(customers)) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: storeId, channelId, importType, customers",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid storeId format",
      });
    }

    // Verify channel exists
    const channel = await Channel.findOne({
      store_id: new mongoose.Types.ObjectId(storeId),
      channel_id: parseInt(channelId),
    });

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Get Point configuration for tier recalculation
    const point = await Point.findOne({
      store_id: new mongoose.Types.ObjectId(storeId),
      channel_id: channel._id,
    });

    const results = {
      success: 0,
      failed: 0,
      notFound: 0,
      errors: [],
    };

    // Process each customer
    for (const customerData of customers) {
      const { email, points: targetPoints } = customerData;

      if (!email || targetPoints === undefined || targetPoints === null) {
        results.failed++;
        results.errors.push({
          email: email || "unknown",
          error: "Missing email or points",
        });
        continue;
      }

      try {
        // Find customer by email, store_id, and channel_id
        const customer = await Customer.findOne({
          email: email.trim().toLowerCase(),
          store_id: new mongoose.Types.ObjectId(storeId),
          channel_id: parseInt(channelId),
        });

        if (!customer) {
          results.notFound++;
          results.errors.push({
            email,
            error: "Customer not found",
          });
          continue;
        }

        // Calculate points difference based on import type
        const currentPoints = customer.points || 0;
        let pointsDifference = 0;
        let description = "";

        if (importType === "add") {
          // Add points to existing balance
          pointsDifference = parseFloat(targetPoints);
          description = `Points added via CSV import: +${pointsDifference}`;
        } else if (importType === "reset") {
          // Reset points to target value
          pointsDifference = parseFloat(targetPoints) - currentPoints;
          description = `Points reset via CSV import: ${currentPoints} → ${parseFloat(targetPoints)}`;
        } else {
          results.failed++;
          results.errors.push({
            email,
            error: "Invalid import type",
          });
          continue;
        }

        // Skip if no change needed
        if (pointsDifference === 0) {
          results.success++;
          continue;
        }

        // Create transaction
        const transaction = await Transaction.createTransaction({
          customerId: customer._id,
          store_id: new mongoose.Types.ObjectId(storeId),
          channel_id: parseInt(channelId),
          bcCustomerId: customer.bcCustomerId,
          type: "adjustment",
          transactionCategory: "manual",
          points: pointsDifference,
          description,
          reason: `Bulk CSV import (${importType})`,
          status: "completed",
          expiresAt: null,
          adminUserId: null,
          source: "admin_panel_csv_import",
          metadata: {
            importType,
            originalPoints: currentPoints,
            targetPoints: parseFloat(targetPoints),
          },
        });

        // Update customer points
        await Customer.updatePoints(
          customer._id,
          pointsDifference,
          "adjustment"
        );

        // Recalculate customer tier after points update
        if (point && point.tierStatus && point.tier && point.tier.length > 0) {
          try {
            const updatedCustomer = await Customer.findById(customer._id);
            if (updatedCustomer) {
              const customerPoints = updatedCustomer.points || 0;
              const sortedTiers = [...point.tier].sort(
                (a, b) => a.pointRequired - b.pointRequired
              );

              let assignedTier = null;
              let assignedTierIndex = 0;

              for (let i = sortedTiers.length - 1; i >= 0; i--) {
                if (customerPoints >= sortedTiers[i].pointRequired) {
                  assignedTier = sortedTiers[i];
                  assignedTierIndex = i;
                  break;
                }
              }

              if (!assignedTier && sortedTiers.length > 0) {
                assignedTier = sortedTiers[0];
                assignedTierIndex = 0;
              }

              if (assignedTier) {
                const nextTierIndex = assignedTierIndex + 1;
                const maxPoints =
                  nextTierIndex < sortedTiers.length
                    ? sortedTiers[nextTierIndex].pointRequired - 1
                    : null;

                updatedCustomer.currentTier = {
                  tierIndex: assignedTierIndex,
                  multiplier: assignedTier.multiplier,
                  minPointsRequired: assignedTier.pointRequired,
                  maxPoints: maxPoints,
                };
                await updatedCustomer.save();
              }
            }
          } catch (tierError) {
            console.error(`⚠️ Error recalculating tier for ${email}:`, tierError);
          }
        }

        results.success++;
      } catch (error) {
        console.error(`❌ Error processing customer ${email}:`, error);
        results.failed++;
        results.errors.push({
          email,
          error: error.message || "Failed to process",
        });
      }
    }

    console.log(
      `✅ Bulk import complete: ${results.success} successful, ${results.failed} failed, ${results.notFound} not found`
    );

    res.json({
      success: true,
      message: "Bulk import completed",
      data: {
        total: customers.length,
        success: results.success,
        failed: results.failed,
        notFound: results.notFound,
        errors: results.errors,
      },
    });
  } catch (error) {
    console.error("❌ Error in bulk import:", error);
    next(error);
  }
};

/**
 * Get points awarded statistics for dashboard
 */
const getPointsAwardedStats = async (req, res, next) => {
  try {
    const { storeId, channelId, startDate, endDate } = req.query;

    // Validate required parameters
    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "storeId is required",
      });
    }

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "channelId is required",
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    // Transaction names to match
    const transactionNames = [
      "Sign Up Bonus",
      "Referral",
      "Purchase Product",
      "Birthday Celebration",
      "Newsletter Bonus",
      "Profile Completion",
      "Event Celebration",
      "Rejoin Bonus",
    ];

    const storeObjectId = new mongoose.Types.ObjectId(storeId);
    const numericChannelId = parseInt(channelId);
    const startDateCurrent = new Date(startDate);
    const endDateCurrent = new Date(endDate);
    endDateCurrent.setHours(23, 59, 59, 999); // Set to end of day

    // Calculate previous period (same duration before start date)
    const periodDuration = endDateCurrent.getTime() - startDateCurrent.getTime();
    const endDatePrevious = new Date(startDateCurrent.getTime() - 1);
    const startDatePrevious = new Date(endDatePrevious.getTime() - periodDuration);

    // Aggregate current period transactions
    const currentPeriodResult = await Transaction.aggregate([
      {
        $match: {
          store_id: storeObjectId,
          channel_id: numericChannelId,
          type: "earn", // Only earned points
          status: "completed",
          $or: [
            { description: { $in: transactionNames } },
            { description: { $regex: /^Event: / } }, // Match "Event: *" patterns
          ],
          createdAt: {
            $gte: startDateCurrent,
            $lte: endDateCurrent,
          },
        },
      },
      {
        $addFields: {
          // Normalize event descriptions to "Event Celebration"
          normalizedDescription: {
            $cond: {
              if: { $regexMatch: { input: "$description", regex: /^Event: / } },
              then: "Event Celebration",
              else: "$description",
            },
          },
        },
      },
      {
        $group: {
          _id: "$normalizedDescription",
          totalPointsCurrent: { $sum: "$points" },
        },
      },
    ]);

    // Aggregate previous period transactions
    const previousPeriodResult = await Transaction.aggregate([
      {
        $match: {
          store_id: storeObjectId,
          channel_id: numericChannelId,
          type: "earn", // Only earned points
          status: "completed",
          $or: [
            { description: { $in: transactionNames } },
            { description: { $regex: /^Event: / } }, // Match "Event: *" patterns
          ],
          createdAt: {
            $gte: startDatePrevious,
            $lte: endDatePrevious,
          },
        },
      },
      {
        $addFields: {
          // Normalize event descriptions to "Event Celebration"
          normalizedDescription: {
            $cond: {
              if: { $regexMatch: { input: "$description", regex: /^Event: / } },
              then: "Event Celebration",
              else: "$description",
            },
          },
        },
      },
      {
        $group: {
          _id: "$normalizedDescription",
          totalPointsPrevious: { $sum: "$points" },
        },
      },
    ]);

    // Create maps for easy lookup
    const currentMap = {};
    currentPeriodResult.forEach((item) => {
      currentMap[item._id] = item.totalPointsCurrent;
    });

    const previousMap = {};
    previousPeriodResult.forEach((item) => {
      previousMap[item._id] = item.totalPointsPrevious;
    });

    // Calculate statistics for each transaction type
    const stats = transactionNames.map((transactionName) => {
      const totalPointsCurrent = currentMap[transactionName] || 0;
      const totalPointsPrevious = previousMap[transactionName] || 0;

      // Calculate growth percentage
      let growth = 0;
      if (totalPointsPrevious > 0) {
        growth = ((totalPointsCurrent - totalPointsPrevious) / totalPointsPrevious) * 100;
      } else if (totalPointsCurrent > 0) {
        growth = 100; // 100% growth if previous was 0 and current > 0
      }

      return {
        transactionName,
        totalPointsCurrent,
        totalPointsPrevious,
        growth: Math.round(growth * 100) / 100, // Round to 2 decimal places
      };
    });

    // Calculate total points awarded
    const totalPointsAwarded = stats.reduce(
      (sum, stat) => sum + stat.totalPointsCurrent,
      0
    );

    res.json({
      success: true,
      data: {
        totalPointsAwarded,
        stats,
      },
    });
  } catch (error) {
    console.error("❌ Error getting points awarded stats:", error);
    next(error);
  }
};

module.exports = {
  getTransactions,
  getTransactionById,
  createTransaction,
  getCustomerTransactions,
  bulkImportPoints,
  getPointsAwardedStats,
};
