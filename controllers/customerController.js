const axios = require("axios");
const mongoose = require("mongoose");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const Customer = require("../models/Customer");
const Point = require("../models/Point");
const Referral = require("../models/Referral");
const { requireAuth } = require("../helpers/bigcommerce");
const queueManager = require("../queues/queueManager");

/**
 * Fetch customers - checks database first, then fetches from BigCommerce if no customers found
 * Handles cursor-based pagination
 */
const fetchAndStoreCustomers = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.query;

    // Validate storeId
    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Store ID format",
      });
    }

    // Validate channelId (required)
    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    if (isNaN(parseInt(channelId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid Channel ID format",
      });
    }

    // Get store
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    // Validate channel exists
    const channel = await Channel.findOne({
      store_id: store._id,
      channel_id: parseInt(channelId),
    });

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // First, check if customers exist in database for this store and channel
    const query = {
      store_id: new mongoose.Types.ObjectId(storeId),
      channel_id: parseInt(channelId),
    };

    const existingCustomersCount = await Customer.countDocuments(query);

    console.log(
      `🔍 Checking database for customers: Found ${existingCustomersCount} customers for store ${storeId} and channel ${channelId}`,
    );

    // If customers exist in database, return them (channel-wise)
    if (existingCustomersCount > 0) {
      // Get Point configuration to check tierStatus
      let tierStatus = false;
      try {
        const point = await Point.findOne({
          store_id: new mongoose.Types.ObjectId(storeId),
          channel_id: channel._id,
        });
        tierStatus = point?.tierStatus || false;
      } catch (pointError) {
        console.warn(
          "⚠️ Could not fetch point configuration:",
          pointError.message,
        );
      }

      // Fetch all customers from database
      const customers = await Customer.find(query)
        .sort({ createdAt: -1 })
        .populate("store_id", "store_name store_hash")
        .lean();

      // Format response similar to getCustomers
      const formattedCustomers = customers.map((customer) => {
        // Determine tier display based on tierStatus
        let tierDisplay = null;
        if (tierStatus && customer.currentTier) {
          const tierIndex = customer.currentTier?.tierIndex || 0;
          const tiers = ["Silver", "Gold", "Platinum", "Diamond"];
          tierDisplay = tiers[tierIndex] || "Bronze";
        }

        return {
          id: customer._id.toString(),
          email: customer.email,
          shop: customer.shop || null,
          firstName: customer.firstName,
          lastName: customer.lastName,
          points: customer.points || 0,
          pointsEarned: customer.pointsEarned || 0,
          pointsRedeemed: customer.pointsRedeemed || 0,
          ordersCount: customer.ordersCount || 0,
          totalSpent: customer.totalSpent || 0,
          joiningDate: customer.joiningDate,
          lastVisit: customer.lastVisit,
          currentTier: customer.currentTier,
          tierDisplay: tierDisplay || "None",
          tierStatus: tierStatus,
          tags: customer.tags || [],
          refferalCount: customer.refferalCount || 0,
          bcCustomerId: customer.bcCustomerId || null,
          storeId: customer.store_id?._id?.toString(),
          channelId: customer.channel_id,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        };
      });

      console.log(
        `✅ Returning ${formattedCustomers.length} customers from database`,
      );

      return res.json({
        success: true,
        message: "Customers retrieved from database",
        data: formattedCustomers,
        pagination: {
          page: 1,
          limit: formattedCustomers.length,
          total: formattedCustomers.length,
          totalPages: 1,
        },
        source: "database",
      });
    }

    // No customers found in database, fetch from BigCommerce
    console.log(
      `🔄 No customers found in database. Fetching customers from BigCommerce for store: ${store.store_hash}`,
    );

    // Get all channels for this store to validate channel IDs
    const storeChannels = await Channel.find({ store_id: store._id });
    const validChannelIds = new Set(storeChannels.map((ch) => ch.channel_id));

    console.log(
      `📋 Found ${storeChannels.length} channels for this store:`,
      Array.from(validChannelIds),
    );

    let allCustomers = [];
    let cursor = null;
    let pageCount = 0;
    const limit = 250; // Max limit per BigCommerce API

    // Fetch all customers using cursor pagination
    // Include addresses in the response to avoid extra API calls
    do {
      try {
        let url = `https://api.bigcommerce.com/stores/${store.store_hash}/v3/customers?limit=${limit}&include=addresses`;
        if (cursor) {
          url += `&cursor=${cursor}`;
        }

        const response = await axios.get(url, {
          headers: {
            "X-Auth-Token": store.access_token,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        });

        const customers = response.data.data || [];
        allCustomers = allCustomers.concat(customers);
        pageCount++;

        // Get next cursor from pagination meta
        const pagination = response.data.meta?.pagination;
        cursor = pagination?.cursor || null;

        console.log(
          `📄 Page ${pageCount}: Fetched ${customers.length} customers. Total so far: ${allCustomers.length}`,
        );
      } catch (error) {
        console.error(
          "❌ Error fetching customers page:",
          error.response?.data || error.message,
        );
        throw error;
      }
    } while (cursor);

    console.log(`✅ Total customers fetched: ${allCustomers.length}`);

    // Transform and store customers in database
    let storedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const bcCustomer of allCustomers) {
      try {
        // Get channel_ids from customer data
        // First check if channel_ids is in the list response
        let customerChannelIds = [];

        if (
          bcCustomer.channel_ids &&
          Array.isArray(bcCustomer.channel_ids) &&
          bcCustomer.channel_ids.length > 0
        ) {
          // Customer has explicit channel_ids in list response
          customerChannelIds = bcCustomer.channel_ids.map((id) => parseInt(id));
          console.log(
            `📋 Customer ${bcCustomer.email} has channel_ids: [${customerChannelIds.join(", ")}]`,
          );
        } else {
          // channel_ids not in list response, fetch individual customer details
          try {
            const customerDetailResponse = await axios.get(
              `https://api.bigcommerce.com/stores/${store.store_hash}/v3/customers?id:in=${bcCustomer.id}`,
              {
                headers: {
                  "X-Auth-Token": store.access_token,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
              },
            );

            if (
              customerDetailResponse.data?.data &&
              customerDetailResponse.data.data.length > 0
            ) {
              const customerDetails = customerDetailResponse.data.data[0];

              if (
                customerDetails.channel_ids &&
                Array.isArray(customerDetails.channel_ids) &&
                customerDetails.channel_ids.length > 0
              ) {
                customerChannelIds = customerDetails.channel_ids.map((id) =>
                  parseInt(id),
                );
                console.log(
                  `📋 Customer ${bcCustomer.email} has channel_ids from detail: [${customerChannelIds.join(", ")}]`,
                );
              } else if (customerDetails.origin_channel_id) {
                customerChannelIds = [
                  parseInt(customerDetails.origin_channel_id),
                ];
                console.log(
                  `📋 Customer ${bcCustomer.email} has origin_channel_id: ${customerDetails.origin_channel_id}`,
                );
              }
            }
          } catch (detailError) {
            console.warn(
              `⚠️ Could not fetch details for customer ${bcCustomer.email}:`,
              detailError.message,
            );
          }

          // If still no channel_ids found, use fallback
          if (customerChannelIds.length === 0) {
            if (bcCustomer.origin_channel_id) {
              customerChannelIds = [parseInt(bcCustomer.origin_channel_id)];
              console.log(
                `📋 Customer ${bcCustomer.email} has origin_channel_id from list: ${bcCustomer.origin_channel_id}`,
              );
            } else {
              // Fallback: assign to requested channel
              customerChannelIds = [parseInt(channelId)];
              console.log(
                `📋 Customer ${bcCustomer.email} has no channel info, assigning to requested channel: ${channelId}`,
              );
            }
          }
        }

        // Create/update customer record for each channel they belong to
        for (const customerChannelId of customerChannelIds) {
          // Check if this channel exists in our database
          if (!validChannelIds.has(customerChannelId)) {
            console.log(
              `⚠️ Channel ${customerChannelId} not found in database, skipping customer ${bcCustomer.email} for this channel`,
            );
            skippedCount++;
            continue;
          }

          // Transform BigCommerce customer data to our schema
          const customerData = {
            email: bcCustomer.email || null,
            shop: store.store_url || null,
            store_id: store._id,
            channel_id: customerChannelId, // Use the channel from customer's channel_ids
            bcCustomerId: bcCustomer.id || null, // BigCommerce customer ID
            acceptsMarketing:
              bcCustomer.accepts_product_review_abandoned_cart_emails !==
              undefined
                ? bcCustomer.accepts_product_review_abandoned_cart_emails
                : bcCustomer.accepts_marketing || false,
            firstName: bcCustomer.first_name || null,
            lastName: bcCustomer.last_name || null,
            joiningDate: bcCustomer.date_created
              ? new Date(bcCustomer.date_created)
              : new Date(),
            lastVisit: bcCustomer.date_modified
              ? new Date(bcCustomer.date_modified)
              : null,
            ordersCount: bcCustomer.orders_count || 0,
            totalSpent: parseFloat(bcCustomer.total_spent || 0),
            tags: bcCustomer.tags || [],
          };

          // Handle default address if available
          // Note: addresses might need to be fetched separately with include=addresses parameter
          if (bcCustomer.addresses && bcCustomer.addresses.length > 0) {
            const defaultAddr =
              bcCustomer.addresses.find(
                (addr) => addr.address1 || addr.address_1,
              ) || bcCustomer.addresses[0];
            customerData.default_address = {
              address1: defaultAddr.address1 || defaultAddr.address_1 || null,
              address2: defaultAddr.address2 || defaultAddr.address_2 || null,
              city: defaultAddr.city || null,
              company: defaultAddr.company || null,
              country: defaultAddr.country || defaultAddr.country_code || null,
              zip: defaultAddr.zip || defaultAddr.postal_code || null,
              province:
                defaultAddr.state || defaultAddr.state_or_province || null,
              default:
                defaultAddr.address_type === "residential" ||
                defaultAddr.is_default ||
                false,
            };
          }

          // Check if customer already exists (by email, store_id, and channel_id)
          const existingCustomer = await Customer.findOne({
            email: customerData.email,
            store_id: customerData.store_id,
            channel_id: customerData.channel_id,
          });

          if (existingCustomer) {
            // Update existing customer
            await Customer.updateCustomer(existingCustomer._id, customerData);
            updatedCount++;
          } else {
            // Create new customer
            await Customer.create(customerData);
            storedCount++;
          }
        }
      } catch (error) {
        console.error(
          `❌ Error processing customer ${bcCustomer.email}:`,
          error.message,
        );
        errorCount++;
      }
    }

    console.log(
      `✅ Customer sync complete: ${storedCount} created, ${updatedCount} updated, ${errorCount} errors, ${skippedCount} skipped`,
    );

    // After storing customers, fetch them from database and return in the same format
    // Get Point configuration to check tierStatus
    let tierStatus = false;
    try {
      const point = await Point.findOne({
        store_id: new mongoose.Types.ObjectId(storeId),
        channel_id: channel._id,
      });
      tierStatus = point?.tierStatus || false;
    } catch (pointError) {
      console.warn(
        "⚠️ Could not fetch point configuration:",
        pointError.message,
      );
    }

    // Fetch all customers from database for this store and channel
    const storedCustomers = await Customer.find(query)
      .sort({ createdAt: -1 })
      .populate("store_id", "store_name store_hash")
      .lean();

    // Format response similar to getCustomers
    const formattedCustomers = storedCustomers.map((customer) => {
      // Determine tier display based on tierStatus
      let tierDisplay = null;
      if (tierStatus && customer.currentTier) {
        const tierIndex = customer.currentTier?.tierIndex || 0;
        const tiers = ["Silver", "Gold", "Platinum", "Diamond"];
        tierDisplay = tiers[tierIndex] || "Bronze";
      }

      return {
        id: customer._id.toString(),
        email: customer.email,
        shop: customer.shop || null,
        firstName: customer.firstName,
        lastName: customer.lastName,
        points: customer.points || 0,
        pointsEarned: customer.pointsEarned || 0,
        pointsRedeemed: customer.pointsRedeemed || 0,
        ordersCount: customer.ordersCount || 0,
        totalSpent: customer.totalSpent || 0,
        joiningDate: customer.joiningDate,
        lastVisit: customer.lastVisit,
        currentTier: customer.currentTier,
        tierDisplay: tierDisplay || "None",
        tierStatus: tierStatus,
        tags: customer.tags || [],
        refferalCount: customer.refferalCount || 0,
        bcCustomerId: customer.bcCustomerId || null,
        storeId: customer.store_id?._id?.toString(),
        channelId: customer.channel_id,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      };
    });

    console.log(
      `✅ Returning ${formattedCustomers.length} customers after fetching from BigCommerce`,
    );

    res.json({
      success: true,
      message: "Customers fetched from BigCommerce and stored successfully",
      data: formattedCustomers,
      pagination: {
        page: 1,
        limit: formattedCustomers.length,
        total: formattedCustomers.length,
        totalPages: 1,
      },
      source: "bigcommerce",
      syncStats: {
        totalFetched: allCustomers.length,
        stored: storedCount,
        updated: updatedCount,
        errors: errorCount,
        skipped: skippedCount,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching and storing customers:", error);

    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        message: error.response.data?.title || "Failed to fetch customers",
        error: error.response.data,
      });
    }

    next(error);
  }
};

/**
 * Get all customers from database
 */
const getCustomers = async (req, res, next) => {
  try {
    const { storeId, channelId, page = 1, limit = 50 } = req.query;

    // Validate storeId
    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Store ID format",
      });
    }

    // Validate channelId (required)
    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    if (isNaN(parseInt(channelId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid Channel ID format",
      });
    }

    // Build query - always filter by both store_id and channel_id
    const query = {
      store_id: new mongoose.Types.ObjectId(storeId),
      channel_id: parseInt(channelId),
    };

    console.log("🔍 Fetching customers with query:", {
      storeId,
      channelId: parseInt(channelId),
      page: parseInt(page),
      limit: parseInt(limit),
    });

    // Get Channel document to find MongoDB ObjectId
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

    // Get Point configuration to check tierStatus
    let tierStatus = false;
    try {
      const point = await Point.findOne({
        store_id: new mongoose.Types.ObjectId(storeId),
        channel_id: channel._id,
      });
      tierStatus = point?.tierStatus || false;
    } catch (pointError) {
      console.warn(
        "⚠️ Could not fetch point configuration:",
        pointError.message,
      );
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch customers with pagination
    const customers = await Customer.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("store_id", "store_name store_hash")
      .lean();

    // Get total count
    const total = await Customer.countDocuments(query);

    console.log(
      `✅ Found ${customers.length} customers (total: ${total}) for store ${storeId} and channel ${channelId}. Tier status: ${tierStatus}`,
    );

    // Format response
    const formattedCustomers = customers.map((customer) => {
      // Determine tier display based on tierStatus
      let tierDisplay = null;
      if (tierStatus && customer.currentTier) {
        const tierIndex = customer.currentTier?.tierIndex || 0;
        const tiers = ["Silver", "Gold", "Platinum", "Diamond"];
        tierDisplay = tiers[tierIndex] || "Bronze";
      }

      return {
        id: customer._id.toString(),
        email: customer.email,
        shop: customer.shop || null,
        firstName: customer.firstName,
        lastName: customer.lastName,
        points: customer.points || 0,
        pointsEarned: customer.pointsEarned || 0,
        pointsRedeemed: customer.pointsRedeemed || 0,
        ordersCount: customer.ordersCount || 0,
        totalSpent: customer.totalSpent || 0,
        joiningDate: customer.joiningDate,
        lastVisit: customer.lastVisit,
        currentTier: customer.currentTier,
        tierDisplay: tierDisplay || "None", // "None" if tier system is off
        tierStatus: tierStatus, // Include tier status for frontend
        tags: customer.tags || [],
        refferalCount: customer.refferalCount || 0,
        bcCustomerId: customer.bcCustomerId || null,
        storeId: customer.store_id?._id?.toString(),
        channelId: customer.channel_id,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      };
    });

    res.json({
      success: true,
      data: formattedCustomers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Error getting customers:", error);
    next(error);
  }
};

/**
 * Get a single customer by ID
 */
const getCustomerById = async (req, res, next) => {
  try {
    const { customerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Customer ID format",
      });
    }

    const customer = await Customer.findById(customerId)
      .populate("store_id", "store_name store_hash")
      .lean();

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Compute referral_points and refferalCount from Referral collection
    // (handles legacy data where these weren't updated, and ensures accuracy)
    const referralStats = await Referral.aggregate([
      {
        $match: {
          referrer_user_id: customer._id,
          status: "Completed",
        },
      },
      {
        $group: {
          _id: null,
          totalPoints: { $sum: "$referral_points" },
          count: { $sum: 1 },
        },
      },
    ]);
    const referral_points =
      referralStats[0]?.totalPoints ?? customer.referral_points ?? 0;
    const refferalCount =
      referralStats[0]?.count ?? customer.refferalCount ?? 0;

    // Get Channel document to find MongoDB ObjectId
    const channel = await Channel.findOne({
      store_id:
        customer.store_id?._id ||
        new mongoose.Types.ObjectId(customer.store_id),
      channel_id: customer.channel_id,
    });

    // Get Point configuration to check tierStatus and tier options
    let tierStatus = false;
    let tierDisplay = null;
    let tierOptions = null;
    if (channel) {
      try {
        const point = await Point.findOne({
          store_id:
            customer.store_id?._id ||
            new mongoose.Types.ObjectId(customer.store_id),
          channel_id: channel._id,
        });
        tierStatus = point?.tierStatus || false;

        if (tierStatus && point?.tier && point.tier.length > 0) {
          const sortedTiers = [...point.tier].sort(
            (a, b) => a.pointRequired - b.pointRequired,
          );
          const tierIndex = customer.currentTier?.tierIndex ?? 0;
          tierDisplay = sortedTiers[tierIndex]?.tierName || "None";
          tierOptions = {
            maxTierIndex: sortedTiers.length - 1,
            tiers: sortedTiers.map((t, i) => ({
              tierIndex: i,
              tierName: t.tierName || `Tier ${i + 1}`,
            })),
          };
        } else if (tierStatus && customer.currentTier) {
          const tierIndex = customer.currentTier?.tierIndex || 0;
          const tiers = ["Silver", "Gold", "Platinum", "Diamond"];
          tierDisplay = tiers[tierIndex] || "Bronze";
        }
      } catch (pointError) {
        console.warn(
          "⚠️ Could not fetch point configuration:",
          pointError.message,
        );
      }
    }

    res.json({
      success: true,
      data: {
        id: customer._id.toString(),
        email: customer.email,
        shop: customer.shop || null,
        firstName: customer.firstName,
        lastName: customer.lastName,
        points: customer.points || 0,
        pointsEarned: customer.pointsEarned || 0,
        pointsRedeemed: customer.pointsRedeemed || 0,
        ordersCount: customer.ordersCount || 0,
        totalSpent: customer.totalSpent || 0,
        joiningDate: customer.joiningDate,
        lastVisit: customer.lastVisit,
        currentTier: customer.currentTier,
        tierDisplay: tierDisplay || "None", // "None" if tier system is off
        tierStatus: tierStatus, // Include tier status for frontend
        tierOptions, // { maxTierIndex, tiers: [{ tierIndex, tierName }] } for change-tier UI
        default_address: customer.default_address,
        profile: customer.profile,
        dob: customer.dob,
        tags: customer.tags || [],
        refferalCount,
        referral_points,
        bcCustomerId: customer.bcCustomerId || null,
        storeId: customer.store_id?._id?.toString(),
        channelId: customer.channel_id,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
    });
  } catch (error) {
    console.error("❌ Error getting customer:", error);
    next(error);
  }
};

/**
 * Update customer tier (upgrade only). User cannot downgrade tier.
 * If customer is already on top tier, frontend should disable the option.
 */
const updateCustomerTier = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const { tierIndex: newTierIndex } = req.body;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Customer ID format",
      });
    }

    if (
      newTierIndex === undefined ||
      newTierIndex === null ||
      isNaN(Number(newTierIndex))
    ) {
      return res.status(400).json({
        success: false,
        message: "tierIndex is required and must be a number",
      });
    }

    const requestedTierIndex = parseInt(newTierIndex, 10);

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const storeId = customer.store_id?._id || customer.store_id;
    const channel = await Channel.findOne({
      store_id: storeId,
      channel_id: customer.channel_id,
    });
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    const point = await Point.findOne({
      store_id: storeId,
      channel_id: channel._id,
    });
    if (!point || !point.tierStatus || !point.tier || point.tier.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "Tier system is not enabled or no tiers configured for this channel",
      });
    }

    const sortedTiers = [...point.tier].sort(
      (a, b) => a.pointRequired - b.pointRequired,
    );
    const maxTierIndex = sortedTiers.length - 1;
    const currentTierIndex = customer.currentTier?.tierIndex ?? 0;

    // Upgrade only: new tier must be higher than current
    if (requestedTierIndex <= currentTierIndex) {
      return res.status(400).json({
        success: false,
        message:
          "You can only upgrade a customer's tier, not downgrade. Choose a higher tier.",
      });
    }

    if (requestedTierIndex > maxTierIndex || requestedTierIndex < 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid tier. Valid tier index is 0 to ${maxTierIndex}.`,
      });
    }

    const assignedTier = sortedTiers[requestedTierIndex];
    const nextTierIndex = requestedTierIndex + 1;
    const maxPoints =
      nextTierIndex < sortedTiers.length
        ? sortedTiers[nextTierIndex].pointRequired - 1
        : null;

    const newTier = {
      tierIndex: requestedTierIndex,
      multiplier: assignedTier.multiplier,
      minPointsRequired: assignedTier.pointRequired,
      maxPoints,
    };

    await Customer.updateCustomer(customerId, { currentTier: newTier });

    // Optionally set nextTier reference on customer model if it exists
    const updatedCustomer = await Customer.findById(customerId)
      .populate("store_id", "store_name store_hash")
      .lean();

    console.log(
      `✅ Customer tier updated: ${customer.email} (${customerId}) -> Tier ${requestedTierIndex} (${assignedTier.tierName})`,
    );

    // Schedule tier upgrade email - this function only allows upgrades, so always send email
    // if tier system is enabled
    if (point.tierStatus) {
      try {
        const newTierName = assignedTier.tierName || `Tier ${requestedTierIndex + 1}`;
        await queueManager.addTierUpgradeEmailJob({
          customerId: customerId,
          storeId: storeId.toString(),
          channelId: channel._id.toString(),
          newTierName: newTierName,
          newTierIndex: requestedTierIndex,
        }, { delay: 'in 5 seconds' });
        console.log(
          `📧 Tier upgrade email scheduled for customer ${customerId} -> "${newTierName}"`,
        );
      } catch (emailErr) {
        console.warn(`⚠️ Failed to schedule tier upgrade email for ${customerId}:`, emailErr.message);
      }
    }

    res.json({
      success: true,
      message: "Customer tier updated successfully",
      data: {
        id: updatedCustomer._id.toString(),
        currentTier: newTier,
        tierDisplay: assignedTier.tierName,
      },
    });
  } catch (error) {
    console.error("❌ Error updating customer tier:", error);
    next(error);
  }
};

/**
 * Recalculate customer tiers based on updated tier settings
 * This function should be called after tier settings are updated
 */
const recalculateCustomerTiers = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.body;

    // Validate storeId
    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Store ID format",
      });
    }

    // Validate channelId (required)
    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    if (isNaN(parseInt(channelId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid Channel ID format",
      });
    }

    // Get Channel document to find MongoDB ObjectId
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

    // Get Point configuration to get tier settings
    const point = await Point.findOne({
      store_id: new mongoose.Types.ObjectId(storeId),
      channel_id: channel._id,
    });

    if (!point) {
      return res.status(404).json({
        success: false,
        message: "Points configuration not found",
      });
    }

    // Check if tier system is enabled
    if (!point.tierStatus || !point.tier || point.tier.length === 0) {
      return res.json({
        success: true,
        message: "Tier system is not enabled, no recalculation needed",
        data: {
          updated: 0,
          total: 0,
        },
      });
    }

    // Sort tiers by pointRequired in ascending order
    const sortedTiers = [...point.tier].sort(
      (a, b) => a.pointRequired - b.pointRequired,
    );

    // Get all customers for this store and channel
    const customers = await Customer.find({
      store_id: new mongoose.Types.ObjectId(storeId),
      channel_id: parseInt(channelId),
    });

    console.log(
      `🔄 Recalculating tiers for ${customers.length} customers in store ${storeId}, channel ${channelId}`,
    );

    let updatedCount = 0;
    let unchangedCount = 0;
    let emailsScheduled = 0;

    // Recalculate tier for each customer
    for (const customer of customers) {
      const customerPoints = customer.points || 0;
      
      // Capture PREVIOUS tier before recalculation
      const previousTierIndex = customer.currentTier?.tierIndex ?? -1;

      // Find the appropriate tier based on customer's points
      // Customer should be in the highest tier they qualify for
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
          !customer.currentTier ||
          customer.currentTier.tierIndex !== assignedTierIndex ||
          customer.currentTier.multiplier !== assignedTier.multiplier ||
          customer.currentTier.minPointsRequired !==
            assignedTier.pointRequired ||
          customer.currentTier.maxPoints !== maxPoints;

        if (needsUpdate) {
          customer.currentTier = {
            tierIndex: assignedTierIndex,
            multiplier: assignedTier.multiplier,
            minPointsRequired: assignedTier.pointRequired,
            maxPoints: maxPoints,
          };
          await customer.save();
          updatedCount++;
          
          // Check if this is an UPGRADE (not degradation) and schedule email
          if (assignedTierIndex > previousTierIndex && point.tierStatus) {
            try {
              const newTierName = assignedTier.tierName || `Tier ${assignedTierIndex + 1}`;
              await queueManager.addTierUpgradeEmailJob({
                customerId: customer._id.toString(),
                storeId: storeId.toString(),
                channelId: channel._id.toString(),
                newTierName: newTierName,
                newTierIndex: assignedTierIndex,
              }, { delay: 'in 5 seconds' });
              emailsScheduled++;
            } catch (emailErr) {
              console.warn(`⚠️ Failed to schedule tier upgrade email for ${customer._id}:`, emailErr.message);
            }
          }
        } else {
          unchangedCount++;
        }
      }
    }

    console.log(
      `✅ Tier recalculation complete: ${updatedCount} updated, ${unchangedCount} unchanged, ${emailsScheduled} tier upgrade emails scheduled`,
    );

    res.json({
      success: true,
      message: "Customer tiers recalculated successfully",
      data: {
        updated: updatedCount,
        unchanged: unchangedCount,
        total: customers.length,
        emailsScheduled: emailsScheduled,
      },
    });
  } catch (error) {
    console.error("❌ Error recalculating customer tiers:", error);
    next(error);
  }
};

/**
 * Get referrals made by a customer (for Successful Referrals modal)
 */
const getCustomerReferrals = async (req, res, next) => {
  try {
    const { customerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Customer ID format",
      });
    }

    const referrals = await Referral.find({
      referrer_user_id: new mongoose.Types.ObjectId(customerId),
      status: "Completed",
    })
      .populate("referred_user_id", "firstName lastName email")
      .sort({ createdAt: -1 })
      .lean();

    const data = referrals.map((r) => {
      const referred = r.referred_user_id;
      const name =
        referred && (referred.firstName || referred.lastName)
          ? `${referred.firstName || ""} ${referred.lastName || ""}`.trim()
          : r.referred_user_email || "—";
      const email = referred?.email || r.referred_user_email || "—";
      return {
        name,
        email,
        points: r.referral_points || 0,
      };
    });

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("❌ Error getting customer referrals:", error);
    next(error);
  }
};

module.exports = {
  fetchAndStoreCustomers,
  getCustomers,
  getCustomerById,
  getCustomerReferrals,
  updateCustomerTier,
  recalculateCustomerTiers,
};
