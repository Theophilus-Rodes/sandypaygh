-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 08, 2025 at 04:28 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `vendor_portal`
--

-- --------------------------------------------------------

--
-- Table structure for table `admin_orders`
--

CREATE TABLE `admin_orders` (
  `id` int(11) NOT NULL,
  `vendor_id` int(11) DEFAULT NULL,
  `recipient_number` varchar(20) DEFAULT NULL,
  `data_package` varchar(50) DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `network` varchar(20) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `package_id` varchar(50) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `admin_orders`
--

INSERT INTO `admin_orders` (`id`, `vendor_id`, `recipient_number`, `data_package`, `amount`, `network`, `status`, `sent_at`, `package_id`) VALUES
(1, 35, '0549320923', '10GB', 400.00, 'mtn', 'delivered', '2025-05-22 00:50:02', '2025-05-23 21:22'),
(2, 35, '0549320923', '10GB', 400.00, 'mtn', 'delivered', '2025-05-23 20:52:40', '2025-05-23 21:22'),
(3, 35, '0554039303', '10GB', 400.00, 'mtn', 'delivered', '2025-05-23 20:52:40', '2025-05-23 21:22'),
(4, 35, '03439349', '5GB', 6.00, 'mtn', 'processing', '2025-05-23 21:41:03', '2025-05-23 21:41'),
(5, 35, '043499', '10GB', 400.00, 'mtn', 'processing', '2025-05-23 21:41:03', '2025-05-23 21:41'),
(6, 35, '0503430430', '6GB', 10.00, 'telecel', 'processing', '2025-05-23 21:45:03', '2025-05-23 21:45'),
(7, 35, '03439349', '5GB', 6.00, 'mtn', 'delivered', '2025-05-23 21:51:42', '2025-05-23 21:52'),
(8, 35, '043499', '10GB', 400.00, 'mtn', 'delivered', '2025-05-23 21:51:42', '2025-05-23 21:52'),
(9, 35, '03439349', '5GB', 6.00, 'mtn', 'delivered', '2025-05-23 22:03:52', '2025-05-23 22:04'),
(10, 35, '043499', '10GB', 400.00, 'mtn', 'delivered', '2025-05-23 22:03:52', '2025-05-23 22:04'),
(11, 35, '0503430430', '6GB', 10.00, 'telecel', 'delivered', '2025-05-23 22:04:27', '2025-05-23 22:05'),
(12, 35, '05439343034', '5GB', 10.00, 'airteltigo', 'delivered', '2025-05-23 22:15:46', '2025-05-23 21:16'),
(13, 35, '050343', '5GB', 10.00, 'airteltigo', 'delivered', '2025-05-23 22:15:46', '2025-05-23 21:16'),
(14, 35, '0533390338', '10GB', 400.00, 'mtn', 'delivered', '2025-05-23 22:37:28', '2025-05-23 22:37');

-- --------------------------------------------------------

--
-- Table structure for table `afa_requests`
--

CREATE TABLE `afa_requests` (
  `id` int(11) NOT NULL,
  `vendor_id` int(11) NOT NULL,
  `fullname` varchar(100) DEFAULT NULL,
  `id_number` varchar(30) DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `phone_number` varchar(20) DEFAULT NULL,
  `location` varchar(100) DEFAULT NULL,
  `region` varchar(100) DEFAULT NULL,
  `occupation` varchar(100) DEFAULT NULL,
  `submitted_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `status` varchar(20) DEFAULT 'pending',
  `package_id` varchar(50) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `afa_requests`
--

INSERT INTO `afa_requests` (`id`, `vendor_id`, `fullname`, `id_number`, `dob`, `phone_number`, `location`, `region`, `occupation`, `submitted_at`, `status`, `package_id`, `created_at`) VALUES
(1, 35, 'DANIEL A', 'GHA-0912181', '2025-05-01', '0558876581', 'Kumasi', 'Ashanti', 'Teacher', '2025-05-22 10:52:05', 'delivered', NULL, '2025-05-23 14:49:00'),
(2, 35, 'DANIEL A', 'GHA-0912181', '2025-05-01', '0558876581', 'Kumasi', 'Ashanti', 'Teacher', '2025-05-22 12:59:59', 'delivered', NULL, '2025-05-23 14:49:00'),
(3, 35, 'DANIEL A', 'GHA-0912181', '2025-05-01', '0558876581', 'Kumasi', 'Ashanti', 'Teacher', '2025-05-22 13:53:32', 'delivered', NULL, '2025-05-23 14:49:00'),
(4, 35, 'DANIEL Ahh', 'GHA-0912181', '2025-05-01', '0558876581', 'Kumasi', 'Ashanti', 'Teacher', '2025-05-23 13:23:40', 'delivered', '2025-05-23 14:23', '2025-05-23 14:49:00'),
(5, 35, 'DANIEL Ahhjhu', 'GHA-0912181', '2025-05-01', '0558876581', 'Kumasi', 'Ashanti', 'Teacher', '2025-05-23 14:13:05', 'delivered', '2025-05-23 15:13', '2025-05-23 15:13:05'),
(6, 36, 'Moses Akwa', 'GHA-343223', '2025-05-01', '0554343212', 'Kumasi', 'Ashanti', 'Nurse', '2025-05-23 23:48:40', 'delivered', '2025-05-24 00:49', '2025-05-24 00:48:40');

-- --------------------------------------------------------

--
-- Table structure for table `app_settings`
--

CREATE TABLE `app_settings` (
  `setting` varchar(64) NOT NULL,
  `value` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `app_settings`
--

INSERT INTO `app_settings` (`setting`, `value`) VALUES
('access_mode', 'limited');

-- --------------------------------------------------------

--
-- Table structure for table `data_orders`
--

CREATE TABLE `data_orders` (
  `id` int(11) NOT NULL,
  `vendor_id` int(11) NOT NULL,
  `data_package` varchar(50) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `recipient_number` varchar(20) NOT NULL,
  `momo_number` varchar(20) NOT NULL,
  `status` enum('pending','processing','delivered') NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `network` varchar(20) DEFAULT NULL,
  `package_id` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `data_orders`
--

INSERT INTO `data_orders` (`id`, `vendor_id`, `data_package`, `amount`, `recipient_number`, `momo_number`, `status`, `created_at`, `network`, `package_id`) VALUES
(68, 1, '1GB Daily', 6.00, '233532687733', '233532687733', 'pending', '2025-11-07 19:58:14', 'mtn', '2025-11-07 19:57');

-- --------------------------------------------------------

--
-- Table structure for table `data_packages`
--

CREATE TABLE `data_packages` (
  `id` int(11) NOT NULL,
  `network` varchar(20) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `data_package` varchar(50) NOT NULL,
  `status` enum('available','unavailable') DEFAULT 'available',
  `vendor_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `data_packages`
--

INSERT INTO `data_packages` (`id`, `network`, `amount`, `data_package`, `status`, `vendor_id`, `created_at`) VALUES
(1, 'MTN', 10.00, '2GB', 'available', 30, '2025-05-20 19:49:41'),
(2, 'TELECEL', 20.00, '4GB', 'unavailable', 30, '2025-05-20 19:50:19'),
(3, 'MTN', 7.00, '7GB', 'available', 30, '2025-05-20 19:51:01'),
(4, 'MTN', 6.00, '5GB', 'available', 35, '2025-05-21 10:15:48'),
(5, 'MTN', 400.00, '10GB', 'available', 35, '2025-05-21 10:16:00'),
(6, 'MTN', 0.30, '6GB', 'available', 35, '2025-05-22 13:48:29'),
(7, 'TELECEL', 10.00, '6GB', 'available', 35, '2025-05-22 13:48:43'),
(8, 'MTN', 80.00, '6gb', '', 25, '2025-05-23 10:45:05'),
(9, 'MTN', 0.30, '3gb', '', 35, '2025-05-23 11:06:37'),
(10, 'airteltigo', 10.00, '5GB', '', 35, '2025-05-23 12:33:11'),
(11, 'airteltigo', 6.00, '4GB', '', 35, '2025-05-23 12:53:04'),
(12, 'MTN', 6.00, '5GB', 'available', 36, '2025-05-23 23:56:30'),
(13, 'MTN', 10.00, '10GB', 'available', 36, '2025-05-23 23:56:48'),
(14, 'MTN', 20.00, '20', 'available', 36, '2025-05-23 23:57:01'),
(15, 'TELECEL', 6.00, '5GB', 'available', 36, '2025-05-23 23:57:13'),
(16, 'TELECEL', 10.00, '10GB', 'available', 36, '2025-05-23 23:57:21'),
(17, 'airteltigo', 10.00, '5GB', 'available', 36, '2025-05-23 23:57:33'),
(18, 'airteltigo', 20.00, '10GB', 'available', 36, '2025-05-23 23:57:44'),
(19, 'MTN', 1.00, '10GB', 'available', 36, '2025-05-24 11:49:25'),
(20, 'TELECEL', 1.00, '2GB', 'available', 36, '2025-05-24 13:14:49'),
(21, 'MTN', 1.00, '10GB', 'available', 37, '2025-05-24 14:44:48'),
(22, 'MTN', 1.00, '5GB', 'available', 40, '2025-05-24 20:13:54'),
(23, 'airteltigo', 1.00, '5GB', 'available', 40, '2025-05-24 20:16:48'),
(24, 'MTN', 1.00, '5GB', 'available', 41, '2025-05-25 17:23:57'),
(25, 'MTN', 6.00, '1GB Daily', 'available', 1, '2025-11-07 07:03:26'),
(26, 'AirtelTigo', 20.00, '2GB Weekly', 'available', 1, '2025-11-07 07:03:26'),
(27, 'Telecel', 65.00, '5GB Monthly', 'available', 1, '2025-11-07 07:03:26');

-- --------------------------------------------------------

--
-- Table structure for table `downloaded_flags`
--

CREATE TABLE `downloaded_flags` (
  `vendor_id` int(11) NOT NULL,
  `network` varchar(10) DEFAULT NULL,
  `marked_at` datetime DEFAULT current_timestamp(),
  `package_id` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `downloaded_flags`
--

INSERT INTO `downloaded_flags` (`vendor_id`, `network`, `marked_at`, `package_id`) VALUES
(35, 'mtn', '2025-05-22 22:23:25', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `downloads`
--

CREATE TABLE `downloads` (
  `id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `network` varchar(20) DEFAULT NULL,
  `date` date DEFAULT NULL,
  `recipient` varchar(100) DEFAULT NULL,
  `quantity` varchar(50) DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `payment` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `updated_reference` varchar(100) DEFAULT NULL,
  `platform` varchar(50) DEFAULT 'sandypay',
  `action` varchar(50) DEFAULT 'pending'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payments`
--

CREATE TABLE `payments` (
  `id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `transaction_id` varchar(100) DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `network` varchar(20) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `pricing_airteltigo`
--

CREATE TABLE `pricing_airteltigo` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `data_plan` varchar(50) NOT NULL,
  `cost_price` decimal(10,2) NOT NULL,
  `selling_price` decimal(10,2) DEFAULT NULL,
  `status` enum('available','not available') DEFAULT 'not available',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `pricing_mtn`
--

CREATE TABLE `pricing_mtn` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `data_plan` varchar(50) NOT NULL,
  `cost_price` decimal(10,2) NOT NULL,
  `selling_price` decimal(10,2) DEFAULT NULL,
  `status` enum('available','not available') DEFAULT 'not available',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `pricing_mtn`
--

INSERT INTO `pricing_mtn` (`id`, `user_id`, `data_plan`, `cost_price`, `selling_price`, `status`, `created_at`) VALUES
(5, 25, '1GB', 6.00, 5.00, 'available', '2025-05-03 12:54:04'),
(6, 25, '2GB', 12.00, 6.00, 'available', '2025-05-03 12:54:08'),
(7, 25, '3GB', 17.00, 7.00, 'available', '2025-05-03 12:54:12'),
(8, 26, '1GB', 6.00, 10.00, 'available', '2025-05-03 12:56:35'),
(9, 26, '2GB', 12.00, 21.00, 'available', '2025-05-03 12:56:40'),
(10, 27, '1GB', 6.00, 8.00, 'available', '2025-05-03 12:58:51'),
(11, 27, '2GB', 12.00, 55.00, 'available', '2025-05-03 12:58:54'),
(14, 30, '1GB', 6.00, 12.00, 'available', '2025-05-08 19:47:20'),
(15, 30, '2GB', 12.00, 14.00, 'available', '2025-05-08 19:47:21'),
(16, 30, '3GB', 17.00, 22.00, 'available', '2025-05-08 19:47:22'),
(17, 30, '4GB', 22.00, 22.00, 'available', '2025-05-08 19:47:23'),
(18, 30, '5GB', 27.00, 55.00, 'available', '2025-05-11 16:35:43');

-- --------------------------------------------------------

--
-- Table structure for table `pricing_telecel`
--

CREATE TABLE `pricing_telecel` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `data_plan` varchar(50) NOT NULL,
  `cost_price` decimal(10,2) NOT NULL,
  `selling_price` decimal(10,2) DEFAULT NULL,
  `status` enum('available','not available') DEFAULT 'not available',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `pricing_telecel`
--

INSERT INTO `pricing_telecel` (`id`, `user_id`, `data_plan`, `cost_price`, `selling_price`, `status`, `created_at`) VALUES
(4, 26, '5GB', 25.00, 23.00, 'available', '2025-05-03 12:56:51');

-- --------------------------------------------------------

--
-- Table structure for table `sales_summary`
--

CREATE TABLE `sales_summary` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `date` date NOT NULL,
  `sales_selling` decimal(10,2) DEFAULT 0.00,
  `sales_cost` decimal(10,2) DEFAULT 0.00,
  `gross_profit` decimal(10,2) GENERATED ALWAYS AS (`sales_selling` - `sales_cost`) STORED,
  `sms_ussd` decimal(10,2) DEFAULT 0.00,
  `used_sessions` decimal(10,2) DEFAULT 0.00,
  `net_profit` decimal(10,2) GENERATED ALWAYS AS (`gross_profit` - `sms_ussd` - `used_sessions`) STORED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `telephone_numbers`
--

CREATE TABLE `telephone_numbers` (
  `id` int(11) NOT NULL,
  `phone_number` varchar(15) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `status` enum('allowed','denied') DEFAULT 'allowed'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `telephone_numbers`
--

INSERT INTO `telephone_numbers` (`id`, `phone_number`, `created_at`, `status`) VALUES
(1, '0245629209', '2025-11-06 06:55:11', 'allowed'),
(2, '203980939', '2025-11-06 07:07:21', 'allowed'),
(3, '559383938', '2025-11-06 07:07:21', 'allowed'),
(4, '249830938', '2025-11-06 07:07:21', 'allowed'),
(8, '0509409484', '2025-11-06 07:10:13', 'allowed'),
(9, '0209839383', '2025-11-06 07:10:13', 'allowed'),
(10, '0298303933', '2025-11-06 07:10:13', 'allowed'),
(11, '0559840494', '2025-11-06 07:10:13', 'allowed'),
(13, '0557729693', '2025-11-07 21:20:19', 'allowed');

-- --------------------------------------------------------

--
-- Table structure for table `total_revenue`
--

CREATE TABLE `total_revenue` (
  `id` int(11) NOT NULL,
  `vendor_id` int(11) NOT NULL,
  `source` varchar(100) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `date_received` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `total_revenue`
--

INSERT INTO `total_revenue` (`id`, `vendor_id`, `source`, `amount`, `date_received`) VALUES
(1, 40, '2% from mtn payment', 0.02, '2025-05-25 13:01:41'),
(2, 40, '2% from mtn payment', 0.02, '2025-05-25 14:51:59'),
(3, 41, '2% from mtn payment', 0.02, '2025-05-25 18:27:15'),
(4, 0, '2% from mtn payment', 0.24, '2025-06-16 20:18:18'),
(5, 1, '2% from mtn payment', 0.12, '2025-11-07 07:05:43'),
(6, 1, '2% from mtn payment', 0.12, '2025-11-07 19:19:43'),
(7, 1, '2% from mtn payment', 0.12, '2025-11-07 19:58:14');

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `timestamp` datetime DEFAULT current_timestamp(),
  `reference` varchar(50) NOT NULL,
  `volume` varchar(50) NOT NULL,
  `recipient` varchar(20) NOT NULL,
  `network` varchar(20) NOT NULL,
  `channel` varchar(20) DEFAULT 'USSD',
  `delivery` varchar(20) DEFAULT 'Pending',
  `payment` varchar(50) DEFAULT 'Pending'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `transactions`
--

INSERT INTO `transactions` (`id`, `user_id`, `timestamp`, `reference`, `volume`, `recipient`, `network`, `channel`, `delivery`, `payment`) VALUES
(1, 30, '2025-05-08 20:54:36', 'ee81bd0e', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(2, 30, '2025-05-09 11:07:07', '1fa10c8d', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(3, 30, '2025-05-11 14:30:00', 'bfc25f13', '1GB', 'Self', 'MTN', 'USSD', 'Pending', 'Pending'),
(4, 30, '2025-05-11 14:34:08', '738f1caa', '1GB', 'Self', 'MTN', 'USSD', 'Pending', 'Pending'),
(5, 30, '2025-05-11 14:50:23', 'ee9a318f562f', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(6, 30, '2025-05-11 15:36:40', '37de0b058797', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(7, 30, '2025-05-11 15:49:03', 'c72f16d9efef', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(8, 30, '2025-05-11 15:51:42', 'b0dda87fbe4a', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(9, 30, '2025-05-11 16:09:13', '9e4b0aeec805', '2GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(10, 30, '2025-05-11 16:09:53', 'fc8b962fdb74', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(11, 30, '2025-05-11 16:10:27', 'd5a99b496c00', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(12, 30, '2025-05-11 16:10:52', '02801c551baa', '4GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(13, 30, '2025-05-11 16:29:34', '0721eac814c5', '1GB', 'Self', 'mtn', 'USSD', 'Pending', 'Pending'),
(14, 30, '2025-05-11 16:56:12', '1b7d7fc7763c', '1GB', '0240000000', 'mtn', 'USSD', 'Pending', 'Pending'),
(15, 30, '2025-05-11 16:57:08', 'd2cde5bba898', '1GB', '0240000000', 'mtn', 'USSD', 'Pending', 'Pending'),
(16, 30, '2025-05-11 16:58:13', '778ac40cd3ff', '2GB', '0240000000', 'mtn', 'USSD', 'Pending', 'Pending'),
(17, 30, '2025-05-11 17:09:41', '333e61ba7971', '2GB', '0240000000', 'mtn', 'USSD', 'Pending', 'Pending'),
(18, 30, '2025-05-11 17:10:16', '0564f1368c28', '2GB', '0240000000', 'mtn', 'USSD', 'Pending', 'Pending'),
(19, 30, '2025-05-11 17:11:03', 'f880e823e6b6', '2GB', '0240000000', 'mtn', 'USSD', 'Pending', 'Pending'),
(20, 30, '2025-05-11 17:12:57', '1846fd28a73e', '1GB', '0240000000', 'mtn', 'USSD', 'Pending', 'Pending'),
(21, 30, '2025-05-11 17:13:07', '30beebcc861e', '3GB', '0240000000', 'mtn', 'USSD', 'Pending', 'Pending'),
(22, 30, '2025-05-11 17:17:17', '621b0154a6d7', '3GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(23, 30, '2025-05-11 17:17:36', 'e1da3c2dffa5', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(24, 30, '2025-05-11 17:20:38', '642d0707ad7d', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(25, 30, '2025-05-11 17:20:42', '524a00f5d2c0', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(26, 30, '2025-05-11 17:21:29', '04588f67cbe1', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(27, 30, '2025-05-11 17:27:11', '8e7454f33132', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(28, 30, '2025-05-11 17:27:17', '9e147608abb6', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(29, 30, '2025-05-11 17:37:12', 'b15fed252c82', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(30, 30, '2025-05-11 17:43:31', '40fbe36f6afb', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(31, 30, '2025-05-11 18:15:10', 'cf9c83da9f30', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(32, 30, '2025-05-11 18:23:27', '1b167f630b71', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(33, 30, '2025-05-12 08:07:19', '5917444bf575', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(34, 30, '2025-05-12 08:17:48', 'd6bf12127493', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(35, 30, '2025-05-12 11:47:50', 'ef668fff4710', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(36, 30, '2025-05-12 11:50:55', 'b144f709d84a', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(37, 30, '2025-05-12 11:59:09', '8ca347b36d14', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(38, 30, '2025-05-12 12:03:41', '302de8241694', '5GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(39, 30, '2025-05-12 12:14:47', 'b6e22e285f01', '1GB', '0240000000', 'MTN', 'USSD', 'Pending', 'Pending'),
(40, 30, '2025-05-12 12:33:52', '4aa41bc8f695', '1GB', '52530', 'MTN', 'USSD', 'Pending', 'Pending'),
(41, 30, '2025-05-12 12:37:06', '5f356d150095', '2GB', '0504343456', 'MTN', 'USSD', 'Pending', 'Pending');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `username` varchar(100) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `sender_id` varchar(50) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('admin','vendor') DEFAULT 'vendor',
  `status` enum('active','dormant','inactive') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `ussd_code` varchar(50) DEFAULT NULL,
  `public_link` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `phone`, `sender_id`, `password`, `role`, `status`, `created_at`, `ussd_code`, `public_link`) VALUES
(25, 'Bennardo', '0504602107', 'edutheo33@gmail.com', '$2b$10$yUdhhwPOEHG1pLNkaAqeV.wC96aKuyDQj9Qj4F30oIRQV.2XCW1NO', 'admin', 'active', '2025-05-03 12:51:46', NULL, NULL),
(26, 'Amah', '02432882312', 'edutheo33@gmail.com', '$2b$10$T7yvm9JTQqeNA3lPkMcbN.9gb2aJgIGDqAzHKLjQYwNo38aBbxzoi', 'vendor', 'active', '2025-05-03 12:56:00', NULL, NULL),
(27, 'Kofi', '910291082', 'edutheo33@gmail.com', '$2b$10$rI9YDSPAKNvfxQ/c04RrpuCfU1umBoAbXuqBMDAu0WOmo4mFFIOle', 'vendor', 'inactive', '2025-05-03 12:58:19', NULL, NULL),
(28, 'James', '021821299', 'edutheo33@gmail.com', '$2b$10$sDNLZ3KUxGO9.rIa7Jiu6epv29LMyxJdZpL5iGoGsrIvU7t8iXJ26', 'admin', 'inactive', '2025-05-06 10:04:00', '*203*555*28#', NULL),
(29, 'Manu', '0393023292', 'edutheo33@gmail.com', '$2b$10$uC89bZvAet6qmXTNxBP5euLVWUjJvEMP/Y0HvnawsEYBIrilXZQMy', 'vendor', 'active', '2025-05-06 10:07:54', '*203*555*29#', NULL),
(30, 'Pixles', '0504602107', 'edutheo33@gmail.com', '$2b$10$dUbpAl0finxtewdElRHmrOtGxZuSKQZp76dOXC831eyRYzu23lQ9a', 'vendor', 'active', '2025-05-07 20:53:06', '*203*555*30#', NULL),
(31, 'Alpha Kuma', '0504602107', 'edutheo33@gmail.com', '$2b$10$zSnsCoNjnEU4eIFqKnZXUu56G8D6n7uSQdCByxZZIxrfsWFZU7my.', 'vendor', 'active', '2025-05-08 13:42:14', '*203*555*31#', NULL),
(32, 'Joe', '0504602107', 'edutheo33@gmail.com', '$2b$10$sWZ7tFSI8U08WB/XBfvHS.XNnfA6R0iKlAIBE87.dxAraOY9Q1RCm', 'vendor', 'active', '2025-05-20 20:50:52', NULL, NULL),
(33, 'joe', '0504602107', 'edutheo33@gmail.com', '$2b$10$9yScvmA/sk/3/.2zlIVc7.UcYDQaPFp8WS.mRdoMzTGi37oFmIGW6', 'vendor', 'active', '2025-05-20 21:00:01', '*203*555*33#', 'http://localhost:5500/index1.html?id=33'),
(34, 'Chales', '0504602107', 'chalesamaniampong29@gmail.com', '$2b$10$KDNgmAzWrf3TKsx5dbrVmeAmh1JDl/uBLVl3vbtBlh9jJ7Xvvpc1.', 'vendor', 'active', '2025-05-21 09:25:15', '*203*555*34#', 'http://localhost:5500/index1.html?id=34'),
(35, 'Moses', '0504602107', 'samuelowusuakwasi69@gmail.com', '$2b$10$RK08NxtKRiFufF/tmMFEaO3zAnmS8EyqiAD6LIPAOE3i39Y8w6PBa', 'vendor', 'active', '2025-05-21 09:47:21', '*203*555*35#', 'http://127.0.0.1:5500/index1.html?id=35'),
(36, 'Nana Yaa', '0504602107', 'edutheo33@gmail.com', '$2b$10$IDBtxDz.5NuG8AvcEVBnbe5Yv57elF3OTXUbLi1e6MME1HxSynBTG', 'vendor', 'active', '2025-05-23 23:46:08', '*203*555*36#', 'http://127.0.0.1:5500/index1.html?id=36'),
(37, 'Vine', '0504602107', 'edutheo33@gmail.com', '$2b$10$fQacQV6pMiKiWr/fm.upXuMuakMYSWKvWFi1Z9rm/7uTk0WrcbnaS', 'vendor', 'active', '2025-05-24 14:44:01', '*203*555*37#', 'http://127.0.0.1:5500/index1.html?id=37'),
(38, 'Joe', '0243324276', 'ajoseph@oxtranz.com', '$2b$10$GDcgvuH/NuWVQNEyWHcTH.jU.TnGqgFFG2I2up1hBxgNQaDikK0H.', 'vendor', 'active', '2025-05-24 19:52:59', '*203*555*38#', 'http://127.0.0.1:5500/index1.html?id=38'),
(39, 'Oxtranz', '0243324276', 'ajoseph@oxtranz.com', '$2b$10$G5nMoN9dpTAQXS0DHarWBuvtiZFS5SXWJipefd8gyh8deR5/x6n06', 'vendor', 'active', '2025-05-24 20:02:09', '*203*555*39#', 'http://127.0.0.1:5500/index1.html?id=39'),
(40, 'Vinepixles', '0548081608', 'vinepixleslab@gmail.com', '$2b$10$uevqLFoLUSTZb1gkLxmQQeS2Ha9u4arwRfEskndiKpNxFjS9ZyNru', 'vendor', 'active', '2025-05-24 20:11:59', '*203*555*40#', 'http://127.0.0.1:5500/index1.html?id=40'),
(41, 'Mary', '0504602107', 'edutheo33@gmail.com', '$2b$10$31n3VzENsFpDqC4q2UTEOur6/eWAQMwA8jKx.eBmL4KUKsgk6AaKq', 'vendor', 'active', '2025-05-25 17:20:13', '*203*555*41#', 'http://127.0.0.1:5500/index1.html?id=41');

-- --------------------------------------------------------

--
-- Table structure for table `wallet_loads`
--

CREATE TABLE `wallet_loads` (
  `id` int(11) NOT NULL,
  `vendor_id` int(11) NOT NULL,
  `momo` varchar(20) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `date_loaded` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `wallet_loads`
--

INSERT INTO `wallet_loads` (`id`, `vendor_id`, `momo`, `amount`, `date_loaded`) VALUES
(4, 35, '0245676789', 100.00, '2025-05-22 20:07:50'),
(5, 35, '0245676789', 150.00, '2025-05-22 20:58:09'),
(6, 25, '0550440494', 200.00, '2025-05-23 11:11:09'),
(7, 35, '0559943039', -20.00, '2025-05-23 19:28:32'),
(8, 36, '0504602107', 100.00, '2025-05-24 00:58:16'),
(9, 36, '0504602107', -1.00, '2025-05-24 00:58:47'),
(10, 36, '0504602107', -25.00, '2025-05-24 00:59:01'),
(11, 36, '23223', -74.00, '2025-05-24 12:49:57'),
(12, 36, '233532687733', 1.00, '2025-05-24 14:13:34'),
(13, 36, '0532687733', 1.00, '2025-05-24 14:19:47'),
(14, 36, '0532687733', 1.00, '2025-05-24 15:10:30'),
(15, 36, '0532687733', 1.00, '2025-05-24 15:18:48'),
(16, 36, '0504602107', 1.00, '2025-05-24 15:30:09'),
(17, 37, '0532687733', 1.00, '2025-05-24 15:45:36'),
(18, 40, '0532687733', 1.00, '2025-05-24 21:14:45'),
(19, 40, '0532687733', 0.98, '2025-05-25 13:01:41'),
(20, 40, '0532687733', 0.98, '2025-05-25 14:51:59'),
(21, 40, '0532687733', 1.00, '2025-05-25 17:02:36'),
(22, 40, '0532687733', 1.00, '2025-05-25 17:37:41'),
(23, 40, '0532687733', -2.00, '2025-05-25 17:51:21'),
(24, 41, '0532687733', 1.00, '2025-05-25 18:23:18'),
(25, 41, '0532687733', 0.98, '2025-05-25 18:27:15'),
(26, 0, '233530247144', 11.76, '2025-06-16 20:18:18'),
(27, 1, '233532687733', 5.88, '2025-11-07 07:05:43'),
(28, 1, '233532687733', 5.88, '2025-11-07 19:19:43'),
(29, 1, '233532687733', 5.88, '2025-11-07 19:58:14');

-- --------------------------------------------------------

--
-- Table structure for table `whatsapp_community_links`
--

CREATE TABLE `whatsapp_community_links` (
  `id` int(11) NOT NULL,
  `vendor_id` int(11) NOT NULL,
  `link` varchar(255) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `withdrawals`
--

CREATE TABLE `withdrawals` (
  `id` int(11) NOT NULL,
  `vendor_id` int(11) NOT NULL,
  `momo_number` varchar(20) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `requested_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `withdrawals`
--

INSERT INTO `withdrawals` (`id`, `vendor_id`, `momo_number`, `amount`, `status`, `requested_at`) VALUES
(4, 35, '0559943039', 20.00, 'pending', '2025-05-23 19:28:32'),
(5, 36, '0504602107', 1.00, 'pending', '2025-05-24 00:58:47'),
(6, 36, '0504602107', 25.00, 'pending', '2025-05-24 00:59:01'),
(7, 36, '23223', 74.00, 'pending', '2025-05-24 12:49:57'),
(8, 40, '0532687733', 2.00, 'pending', '2025-05-25 17:51:21');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `admin_orders`
--
ALTER TABLE `admin_orders`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `afa_requests`
--
ALTER TABLE `afa_requests`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `app_settings`
--
ALTER TABLE `app_settings`
  ADD PRIMARY KEY (`setting`);

--
-- Indexes for table `data_orders`
--
ALTER TABLE `data_orders`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `data_packages`
--
ALTER TABLE `data_packages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `downloaded_flags`
--
ALTER TABLE `downloaded_flags`
  ADD PRIMARY KEY (`vendor_id`);

--
-- Indexes for table `downloads`
--
ALTER TABLE `downloads`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `payments`
--
ALTER TABLE `payments`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `pricing_airteltigo`
--
ALTER TABLE `pricing_airteltigo`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `pricing_mtn`
--
ALTER TABLE `pricing_mtn`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `pricing_telecel`
--
ALTER TABLE `pricing_telecel`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `sales_summary`
--
ALTER TABLE `sales_summary`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `telephone_numbers`
--
ALTER TABLE `telephone_numbers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `phone_number` (`phone_number`),
  ADD UNIQUE KEY `uniq_phone_number` (`phone_number`);

--
-- Indexes for table `total_revenue`
--
ALTER TABLE `total_revenue`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `wallet_loads`
--
ALTER TABLE `wallet_loads`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `whatsapp_community_links`
--
ALTER TABLE `whatsapp_community_links`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `withdrawals`
--
ALTER TABLE `withdrawals`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `admin_orders`
--
ALTER TABLE `admin_orders`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=17;

--
-- AUTO_INCREMENT for table `afa_requests`
--
ALTER TABLE `afa_requests`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `data_orders`
--
ALTER TABLE `data_orders`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=69;

--
-- AUTO_INCREMENT for table `data_packages`
--
ALTER TABLE `data_packages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=28;

--
-- AUTO_INCREMENT for table `downloads`
--
ALTER TABLE `downloads`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `payments`
--
ALTER TABLE `payments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pricing_airteltigo`
--
ALTER TABLE `pricing_airteltigo`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `pricing_mtn`
--
ALTER TABLE `pricing_mtn`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

--
-- AUTO_INCREMENT for table `pricing_telecel`
--
ALTER TABLE `pricing_telecel`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `sales_summary`
--
ALTER TABLE `sales_summary`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `telephone_numbers`
--
ALTER TABLE `telephone_numbers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT for table `total_revenue`
--
ALTER TABLE `total_revenue`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=42;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=42;

--
-- AUTO_INCREMENT for table `wallet_loads`
--
ALTER TABLE `wallet_loads`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=30;

--
-- AUTO_INCREMENT for table `whatsapp_community_links`
--
ALTER TABLE `whatsapp_community_links`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `withdrawals`
--
ALTER TABLE `withdrawals`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `sales_summary`
--
ALTER TABLE `sales_summary`
  ADD CONSTRAINT `sales_summary_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `transactions`
--
ALTER TABLE `transactions`
  ADD CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
